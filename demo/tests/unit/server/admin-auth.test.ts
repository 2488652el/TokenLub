import { describe, expect, it } from 'vitest'
import { createOwnerAdminAuthenticator } from '../../../../drive/src/server/admin-auth'
import { createInMemoryPhase1Store, Phase1AuthService } from '../../../../drive/src/server/phase1'

async function fixture(ownerEmail = 'owner@example.com') {
  const store = createInMemoryPhase1Store()
  const auth = new Phase1AuthService({ store, accessTokenSecret: 'a'.repeat(32) })
  const owner = await auth.registerUser({ email: ownerEmail, password: 'pw' })
  const device = await auth.registerDevice({ userId: owner.id, deviceName: 'owner-device' })
  const session = await auth.login({ email: owner.email, password: 'pw', deviceId: device.id })
  return {
    auth,
    store,
    admin: createOwnerAdminAuthenticator({ auth, store, ownerEmail }),
    owner,
    device,
    session
  }
}

function request(accessToken?: string) {
  return new Request('http://127.0.0.1/v1/admin/metrics', {
    headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {}
  })
}

describe('built-in owner authentication', () => {
  it('accepts the configured owner access token', async () => {
    const { admin, owner, session } = await fixture('Owner@Example.com')

    await expect(admin.verify(request(session.accessToken))).resolves.toMatchObject({
      subject: owner.id,
      expiresAt: expect.any(Number)
    })
  })

  it('rejects another user, a missing bearer, and a revoked owner device', async () => {
    const { admin, auth, device, session } = await fixture()
    const other = await auth.registerUser({ email: 'other@example.com', password: 'pw' })
    const otherDevice = await auth.registerDevice({ userId: other.id, deviceName: 'other-device' })
    const otherSession = await auth.login({
      email: other.email,
      password: 'pw',
      deviceId: otherDevice.id
    })

    await expect(admin.verify(request(otherSession.accessToken))).rejects.toThrow(
      'admin authentication failed'
    )
    await expect(admin.verify(request())).rejects.toThrow('admin authentication failed')

    await auth.revokeDevice(session.accessToken, device.id)
    await expect(admin.verify(request(session.accessToken))).rejects.toThrow(
      'admin authentication failed'
    )
  })
})
