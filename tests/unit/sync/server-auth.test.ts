import { describe, expect, it } from 'vitest'
import {
  createInMemoryPhase1Store,
  Phase1AuthService,
  type RedactedLogEntry
} from '../../../src/server/phase1'

describe('Phase1AuthService', () => {
  it('requires one-time email verification when enabled', async () => {
    let verificationToken = ''
    const auth = new Phase1AuthService({
      store: createInMemoryPhase1Store(),
      requireEmailVerification: true,
      sendVerificationEmail: async ({ token }) => {
        verificationToken = token
      }
    })
    const user = await auth.registerUser({ email: 'verify@example.com', password: 'pw' })
    const device = await auth.registerDevice({ userId: user.id, deviceName: 'desktop' })

    await expect(
      auth.login({ email: user.email, password: 'pw', deviceId: device.id })
    ).rejects.toThrow('email verification required')

    await expect(auth.verifyEmail(verificationToken)).resolves.toMatchObject({
      id: user.id,
      email: user.email
    })
    await expect(auth.verifyEmail(verificationToken)).rejects.toThrow(
      'invalid email verification token'
    )
    await expect(
      auth.login({ email: user.email, password: 'pw', deviceId: device.id })
    ).resolves.toHaveProperty('accessToken')
  })

  it('preserves the store receiver when creating a verification token', async () => {
    const base = createInMemoryPhase1Store()
    const store = {
      ...base,
      tokenWrites: 0,
      createEmailVerificationToken(
        input: Parameters<NonNullable<typeof base.createEmailVerificationToken>>[0]
      ) {
        this.tokenWrites++
        return base.createEmailVerificationToken!(input)
      }
    }
    const auth = new Phase1AuthService({
      store,
      requireEmailVerification: true,
      sendVerificationEmail: async () => undefined
    })

    await auth.registerUser({ email: 'receiver@example.com', password: 'pw' })

    expect(store.tokenWrites).toBe(1)
  })

  it('fails closed before creating a user when verification delivery is missing', async () => {
    const store = createInMemoryPhase1Store()
    const auth = new Phase1AuthService({ store, requireEmailVerification: true })

    await expect(
      auth.registerUser({ email: 'missing-mailer@example.com', password: 'pw' })
    ).rejects.toThrow('email verification is not configured')
    expect(store.getUserByEmail('missing-mailer@example.com')).toBeUndefined()
  })

  it('changes the password and invalidates every existing session', async () => {
    const auth = new Phase1AuthService({ store: createInMemoryPhase1Store() })
    const user = await auth.registerUser({ email: 'password@example.com', password: 'old-pw' })
    const device = await auth.registerDevice({ userId: user.id, deviceName: 'desktop' })
    const first = await auth.login({
      email: user.email,
      password: 'old-pw',
      deviceId: device.id
    })
    const second = await auth.login({
      email: user.email,
      password: 'old-pw',
      deviceId: device.id
    })

    await expect(
      auth.changePassword({
        accessToken: first.accessToken,
        currentPassword: 'old-pw',
        newPassword: 'new-pw'
      })
    ).resolves.toEqual({ ok: true })
    await expect(auth.verifyAccessToken(first.accessToken)).rejects.toThrow(
      'refresh session is no longer active'
    )
    await expect(auth.verifyAccessToken(second.accessToken)).rejects.toThrow(
      'refresh session is no longer active'
    )
    await expect(
      auth.login({ email: user.email, password: 'new-pw', deviceId: device.id })
    ).resolves.toHaveProperty('accessToken')
  })

  it('warns once when a device logs in for the first time', async () => {
    const auth = new Phase1AuthService({ store: createInMemoryPhase1Store() })
    const user = await auth.registerUser({ email: 'notice@example.com', password: 'pw' })
    const device = await auth.registerDevice({ userId: user.id, deviceName: 'desktop' })

    await expect(
      auth.login({ email: user.email, password: 'pw', deviceId: device.id })
    ).resolves.toMatchObject({ securityNotice: 'new_device_login' })
    const second = await auth.login({ email: user.email, password: 'pw', deviceId: device.id })
    expect(second.securityNotice).toBeUndefined()
  })

  it('registers a user, logs in, and binds tokens to a registered device', async () => {
    const logs: RedactedLogEntry[] = []
    const auth = new Phase1AuthService({
      store: createInMemoryPhase1Store(),
      accessTokenTtlMs: 60_000,
      now: () => new Date('2026-07-12T00:00:00.000Z'),
      log: (entry) => logs.push(entry)
    })

    const user = await auth.registerUser({ email: 'Best@Example.com', password: 'correct horse' })
    const device = await auth.registerDevice({ userId: user.id, deviceName: 'Laptop A' })
    const session = await auth.login({
      email: 'best@example.com',
      password: 'correct horse',
      deviceId: device.id
    })

    await expect(auth.verifyAccessToken(session.accessToken, device.id)).resolves.toMatchObject({
      userId: user.id,
      deviceId: device.id
    })
    await expect(auth.verifyAccessToken(session.accessToken, 'other-device')).rejects.toThrow(
      /device mismatch/
    )
    expect(JSON.stringify(logs)).not.toContain(session.accessToken)
    expect(JSON.stringify(logs)).not.toContain(session.refreshToken)
  })

  it('rotates refresh tokens and rejects reuse of the previous token', async () => {
    const auth = new Phase1AuthService({
      store: createInMemoryPhase1Store(),
      now: () => new Date('2026-07-12T00:00:00.000Z')
    })

    const user = await auth.registerUser({ email: 'a@example.com', password: 'pw' })
    const device = await auth.registerDevice({ userId: user.id, deviceName: 'Laptop A' })
    const session = await auth.login({
      email: 'a@example.com',
      password: 'pw',
      deviceId: device.id
    })
    const rotated = await auth.refresh({
      refreshToken: session.refreshToken,
      deviceId: device.id
    })

    expect(rotated.refreshToken).not.toBe(session.refreshToken)
    await expect(auth.verifyAccessToken(rotated.accessToken, device.id)).resolves.toMatchObject({
      sessionId: rotated.sessionId
    })
    await expect(
      auth.refresh({ refreshToken: session.refreshToken, deviceId: device.id })
    ).rejects.toThrow(/refresh session is no longer active/)
  })

  it('rejects an access token forged from another active session', async () => {
    const auth = new Phase1AuthService({
      store: createInMemoryPhase1Store(),
      accessTokenSecret: 'a'.repeat(32)
    })
    const userA = await auth.registerUser({ email: 'a@example.com', password: 'pw' })
    const userB = await auth.registerUser({ email: 'b@example.com', password: 'pw' })
    const deviceA = await auth.registerDevice({ userId: userA.id, deviceName: 'A' })
    const deviceB = await auth.registerDevice({ userId: userB.id, deviceName: 'B' })
    const sessionA = await auth.login({ email: userA.email, password: 'pw', deviceId: deviceA.id })
    const sessionB = await auth.login({ email: userB.email, password: 'pw', deviceId: deviceB.id })
    const decode = (token: string) =>
      JSON.parse(Buffer.from(token.split('.')[0]!, 'base64url').toString('utf8')) as Record<
        string,
        unknown
      >
    const claimsA = decode(sessionA.accessToken)
    const claimsB = decode(sessionB.accessToken)
    const forged = `${Buffer.from(JSON.stringify({ ...claimsA, ...claimsB }), 'utf8').toString('base64url')}.${sessionA.accessToken.split('.')[1] ?? ''}`

    await expect(auth.verifyAccessToken(forged, deviceB.id)).rejects.toThrow(/invalid access token/)
  })

  it('logs out the current session and invalidates both token types', async () => {
    const auth = new Phase1AuthService({
      store: createInMemoryPhase1Store(),
      now: () => new Date('2026-07-12T00:00:00.000Z')
    })

    const user = await auth.registerUser({ email: 'logout@example.com', password: 'pw' })
    const device = await auth.registerDevice({ userId: user.id, deviceName: 'Laptop A' })
    const session = await auth.login({
      email: 'logout@example.com',
      password: 'pw',
      deviceId: device.id
    })

    await auth.logout({ accessToken: session.accessToken, deviceId: device.id })

    await expect(auth.verifyAccessToken(session.accessToken, device.id)).rejects.toThrow(
      /refresh session is no longer active/
    )
    await expect(
      auth.refresh({ refreshToken: session.refreshToken, deviceId: device.id })
    ).rejects.toThrow(/refresh session is no longer active/)
  })

  it('lists devices and revokes a device with all of its sessions', async () => {
    const audits: string[] = []
    const controls: string[] = []
    const store = createInMemoryPhase1Store()
    store.appendAuditEvent = async (event) => {
      audits.push(event.eventType)
    }
    store.appendControlEvent = async (event) => {
      controls.push(event.type)
    }
    const auth = new Phase1AuthService({
      store,
      now: () => new Date('2026-07-12T00:00:00.000Z')
    })

    const user = await auth.registerUser({ email: 'devices@example.com', password: 'pw' })
    const deviceA = await auth.registerDevice({ userId: user.id, deviceName: 'Laptop A' })
    const deviceB = await auth.registerDevice({ userId: user.id, deviceName: 'Laptop B' })
    const sessionA = await auth.login({
      email: 'devices@example.com',
      password: 'pw',
      deviceId: deviceA.id
    })
    const sessionB = await auth.login({
      email: 'devices@example.com',
      password: 'pw',
      deviceId: deviceB.id
    })

    await expect(auth.listDevices(sessionA.accessToken)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: deviceA.id }),
        expect.objectContaining({ id: deviceB.id })
      ])
    )
    await auth.revokeDevice(sessionA.accessToken, deviceB.id)

    await expect(auth.verifyAccessToken(sessionB.accessToken, deviceB.id)).rejects.toThrow(
      /device revoked/
    )
    await expect(
      auth.refresh({ refreshToken: sessionB.refreshToken, deviceId: deviceB.id })
    ).rejects.toThrow(/device revoked/)
    expect(controls).toContain('device_revoked')
    expect(audits).toContain('device.revoked')
  })
})
