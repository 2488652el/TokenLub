import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

export type RedactedLogEntry = {
  level: 'info' | 'warn' | 'error'
  event: string
  userId?: string
  deviceId?: string
  sessionId?: string
}

export type Phase1User = {
  id: string
  email: string
  passwordHash: string
  createdAt: string
  emailVerifiedAt: string | null
}

export type Phase1Device = {
  id: string
  userId: string
  name: string
  platform: string
  appVersion: string
  createdAt: string
  lastSeenAt: string | null
  revokedAt: string | null
}

export type Phase1RefreshSession = {
  id: string
  userId: string
  deviceId: string
  refreshTokenHash: string
  active: boolean
  createdAt: string
  rotatedAt: string | null
}

type EmailVerificationToken = {
  userId: string
  tokenHash: string
  expiresAt: string
  consumedAt: string | null
}

export type AuditEventInput = {
  actorType: 'user' | 'admin' | 'system'
  actorId?: string | null
  userId?: string | null
  eventType: string
  traceId?: string | null
  metadata?: Record<string, unknown>
  createdAt: string
}

export type AuditEventRecord = AuditEventInput & { id: string }

export type ControlEventInput = {
  userId: string
  targetDeviceId?: string | null
  type: 'device_revoked' | 'cloud_data_deleted' | 'sync_disabled'
  payload?: Record<string, unknown> | null
  createdAt: string
}

export type MaybePromise<T> = T | Promise<T>

export type Phase1Store = {
  createUser(input: {
    email: string
    passwordHash: string
    createdAt: string
  }): MaybePromise<Phase1User>
  getUserByEmail(email: string): MaybePromise<Phase1User | undefined>
  getUserById(id: string): MaybePromise<Phase1User | undefined>
  updateUserPassword(userId: string, passwordHash: string): MaybePromise<boolean>
  createEmailVerificationToken?(input: {
    userId: string
    tokenHash: string
    expiresAt: string
  }): MaybePromise<void>
  consumeEmailVerificationToken?(
    tokenHash: string,
    consumedAt: string
  ): MaybePromise<string | undefined>
  markUserEmailVerified?(userId: string, verifiedAt: string): MaybePromise<Phase1User | undefined>
  createDevice(input: {
    userId: string
    name: string
    platform?: string
    appVersion?: string
    createdAt: string
  }): MaybePromise<Phase1Device>
  getDevice(id: string): MaybePromise<Phase1Device | undefined>
  listDevices(userId: string): MaybePromise<Phase1Device[]>
  touchDevice?(deviceId: string, lastSeenAt: string): MaybePromise<void>
  updateDeviceName(
    userId: string,
    deviceId: string,
    name: string
  ): MaybePromise<Phase1Device | undefined>
  revokeDevice(userId: string, deviceId: string, revokedAt: string): MaybePromise<void>
  createRefreshSession(input: {
    userId: string
    deviceId: string
    refreshTokenHash: string
    createdAt: string
  }): MaybePromise<Phase1RefreshSession>
  getRefreshSessionByTokenHash(
    refreshTokenHash: string
  ): MaybePromise<Phase1RefreshSession | undefined>
  getRefreshSessionById(id: string): MaybePromise<Phase1RefreshSession | undefined>
  listRefreshSessions(userId: string): MaybePromise<Phase1RefreshSession[]>
  deactivateRefreshSession(id: string, rotatedAt: string): MaybePromise<void>
  deactivateRefreshSessions(userId: string, rotatedAt: string): MaybePromise<void>
  rotateRefreshSession(input: {
    oldSessionId: string
    userId: string
    deviceId: string
    refreshTokenHash: string
    rotatedAt: string
    createdAt: string
  }): MaybePromise<Phase1RefreshSession | undefined>
  appendAuditEvent?(event: AuditEventInput): MaybePromise<void>
  listAuditEvents?(limit: number): MaybePromise<AuditEventRecord[]>
  appendControlEvent?(event: ControlEventInput): MaybePromise<void>
}

type AuthServiceOptions = {
  store: Phase1Store
  accessTokenTtlMs?: number
  accessTokenSecret?: string
  now?: () => Date
  log?: (entry: RedactedLogEntry) => void
  requireEmailVerification?: boolean
  sendVerificationEmail?: (input: { email: string; token: string }) => MaybePromise<void>
}

type AccessTokenClaims = {
  userId: string
  deviceId: string
  sessionId: string
  expiresAt: number
}

export class Phase1AuthService {
  readonly emailVerificationRequired: boolean
  private readonly store: Phase1Store
  private readonly accessTokenTtlMs: number
  private readonly accessTokenSecret: string
  private readonly now: () => Date
  private readonly log: ((entry: RedactedLogEntry) => void) | undefined
  private readonly requireEmailVerification: boolean
  private readonly sendVerificationEmail:
    ((input: { email: string; token: string }) => MaybePromise<void>) | undefined

  constructor(options: AuthServiceOptions) {
    this.store = options.store
    this.accessTokenTtlMs = options.accessTokenTtlMs ?? 15 * 60_000
    this.accessTokenSecret = options.accessTokenSecret ?? randomToken()
    this.now = options.now ?? (() => new Date())
    this.log = options.log
    this.requireEmailVerification = options.requireEmailVerification ?? false
    this.emailVerificationRequired = this.requireEmailVerification
    this.sendVerificationEmail = options.sendVerificationEmail
  }

  async registerUser(input: { email: string; password: string }): Promise<Phase1User> {
    const email = normalizeEmail(input.email)
    if (await this.store.getUserByEmail(email)) throw new Error('email already registered')
    if (
      this.requireEmailVerification &&
      (!this.store.createEmailVerificationToken || !this.sendVerificationEmail)
    ) {
      throw new Error('email verification is not configured')
    }
    const sendVerificationEmail = this.sendVerificationEmail
    const user = await this.store.createUser({
      email,
      passwordHash: hashPassword(input.password),
      createdAt: this.now().toISOString()
    })
    if (this.requireEmailVerification) {
      const token = randomToken()
      await this.store.createEmailVerificationToken!({
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(this.now().getTime() + 24 * 60 * 60_000).toISOString()
      })
      await sendVerificationEmail!({ email: user.email, token })
    }
    await this.store.appendAuditEvent?.({
      actorType: 'user',
      actorId: user.id,
      userId: user.id,
      eventType: 'user.registered',
      createdAt: this.now().toISOString()
    })
    this.log?.({ level: 'info', event: 'auth.user_registered', userId: user.id })
    return user
  }

  async registerDevice(input: {
    userId: string
    deviceName: string
    platform?: string
    appVersion?: string
  }): Promise<Phase1Device> {
    if (!(await this.store.getUserById(input.userId))) throw new Error('user not found')
    const device = await this.store.createDevice({
      userId: input.userId,
      name: input.deviceName,
      ...(input.platform ? { platform: input.platform } : {}),
      ...(input.appVersion ? { appVersion: input.appVersion } : {}),
      createdAt: this.now().toISOString()
    })
    await this.store.appendAuditEvent?.({
      actorType: 'user',
      actorId: input.userId,
      userId: input.userId,
      eventType: 'device.registered',
      metadata: { deviceId: device.id },
      createdAt: this.now().toISOString()
    })
    this.log?.({
      level: 'info',
      event: 'auth.device_registered',
      userId: input.userId,
      deviceId: device.id
    })
    return device
  }

  async registerDeviceForAccessToken(
    accessToken: string,
    deviceName: string,
    platform?: string,
    appVersion?: string
  ): Promise<Phase1Device> {
    const claims = await this.verifyAccessToken(accessToken)
    return this.registerDevice({
      userId: claims.userId,
      deviceName,
      ...(platform ? { platform } : {}),
      ...(appVersion ? { appVersion } : {})
    })
  }

  async login(input: { email: string; password: string; deviceId: string }): Promise<{
    sessionId: string
    accessToken: string
    refreshToken: string
    expiresAt: string
    securityNotice?: 'new_device_login'
  }> {
    const user = await this.store.getUserByEmail(normalizeEmail(input.email))
    if (!user || !verifyPassword(input.password, user.passwordHash)) {
      throw new Error('invalid credentials')
    }
    if (this.requireEmailVerification && !user.emailVerifiedAt) {
      throw new Error('email verification required')
    }
    const device = await this.requireActiveDevice(user.id, input.deviceId)
    const newDeviceLogin = !device.lastSeenAt
    const issued = await this.createSessionForDevice(user.id, device.id, newDeviceLogin)
    return {
      ...issued,
      ...(newDeviceLogin ? { securityNotice: 'new_device_login' as const } : {})
    }
  }

  async createSessionForDevice(userId: string, deviceId: string, newDeviceLogin = false) {
    const device = await this.requireActiveDevice(userId, deviceId)
    const loggedInAt = this.now().toISOString()
    const refreshToken = randomToken()
    const session = await this.store.createRefreshSession({
      userId,
      deviceId: device.id,
      refreshTokenHash: hashToken(refreshToken),
      createdAt: loggedInAt
    })
    await this.store.touchDevice?.(device.id, loggedInAt)
    await this.store.appendAuditEvent?.({
      actorType: 'user',
      actorId: userId,
      userId,
      eventType: 'auth.login',
      metadata: { deviceId: device.id, ...(newDeviceLogin ? { newDeviceLogin: true } : {}) },
      createdAt: loggedInAt
    })
    this.log?.({
      level: 'info',
      event: 'auth.login',
      userId,
      deviceId: device.id,
      sessionId: session.id
    })
    return this.issueSessionTokens(session, refreshToken)
  }

  async verifyEmail(token: string): Promise<Phase1User> {
    if (!this.store.consumeEmailVerificationToken || !this.store.markUserEmailVerified) {
      throw new Error('email verification is not configured')
    }
    const userId = await this.store.consumeEmailVerificationToken(
      hashToken(token),
      this.now().toISOString()
    )
    if (!userId) throw new Error('invalid email verification token')
    const user = await this.store.markUserEmailVerified(userId, this.now().toISOString())
    if (!user) throw new Error('user not found')
    await this.store.appendAuditEvent?.({
      actorType: 'user',
      actorId: user.id,
      userId: user.id,
      eventType: 'user.email_verified',
      createdAt: this.now().toISOString()
    })
    return user
  }

  async refresh(input: { refreshToken: string; deviceId: string }): Promise<{
    sessionId: string
    accessToken: string
    refreshToken: string
    expiresAt: string
  }> {
    const oldSession = await this.store.getRefreshSessionByTokenHash(hashToken(input.refreshToken))
    if (!oldSession) throw new Error('refresh session not found')
    await this.requireActiveDevice(oldSession.userId, input.deviceId)
    if (oldSession.deviceId !== input.deviceId) throw new Error('device mismatch')
    if (!oldSession.active) throw new Error('refresh session is no longer active')

    const rotatedAt = this.now().toISOString()
    const refreshToken = randomToken()
    const nextSession = await this.store.rotateRefreshSession({
      oldSessionId: oldSession.id,
      userId: oldSession.userId,
      deviceId: oldSession.deviceId,
      refreshTokenHash: hashToken(refreshToken),
      rotatedAt,
      createdAt: rotatedAt
    })
    if (!nextSession) throw new Error('refresh session is no longer active')
    await this.store.appendAuditEvent?.({
      actorType: 'user',
      actorId: nextSession.userId,
      userId: nextSession.userId,
      eventType: 'auth.refresh',
      metadata: { deviceId: nextSession.deviceId },
      createdAt: rotatedAt
    })
    this.log?.({
      level: 'info',
      event: 'auth.refresh_rotated',
      userId: nextSession.userId,
      deviceId: nextSession.deviceId,
      sessionId: nextSession.id
    })
    return this.issueSessionTokens(nextSession, refreshToken)
  }

  async verifyAccessToken(accessToken: string, deviceId?: string): Promise<AccessTokenClaims> {
    const claims = parseAccessToken(accessToken, this.accessTokenSecret)
    if (deviceId && claims.deviceId !== deviceId) throw new Error('device mismatch')
    if (claims.expiresAt <= this.now().getTime()) throw new Error('access token expired')
    await this.requireActiveDevice(claims.userId, claims.deviceId)
    const session = await this.store.getRefreshSessionById(claims.sessionId)
    if (
      !session ||
      !session.active ||
      session.userId !== claims.userId ||
      session.deviceId !== claims.deviceId
    ) {
      throw new Error('refresh session is no longer active')
    }
    await this.store.touchDevice?.(claims.deviceId, this.now().toISOString())
    return claims
  }

  async logout(input: { accessToken: string; deviceId: string }): Promise<void> {
    const claims = await this.verifyAccessToken(input.accessToken, input.deviceId)
    const createdAt = this.now().toISOString()
    await this.store.deactivateRefreshSession(claims.sessionId, createdAt)
    await this.store.appendAuditEvent?.({
      actorType: 'user',
      actorId: claims.userId,
      userId: claims.userId,
      eventType: 'auth.logout',
      metadata: { deviceId: claims.deviceId },
      createdAt
    })
    this.log?.({
      level: 'info',
      event: 'auth.logout',
      userId: claims.userId,
      deviceId: claims.deviceId,
      sessionId: claims.sessionId
    })
  }

  async changePassword(input: {
    accessToken: string
    currentPassword: string
    newPassword: string
  }): Promise<{ ok: true }> {
    const claims = await this.verifyAccessToken(input.accessToken)
    const user = await this.store.getUserById(claims.userId)
    if (!user || !verifyPassword(input.currentPassword, user.passwordHash)) {
      throw new Error('invalid credentials')
    }
    const changed = await this.store.updateUserPassword(user.id, hashPassword(input.newPassword))
    if (!changed) throw new Error('user not found')
    const changedAt = this.now().toISOString()
    await this.store.deactivateRefreshSessions(user.id, changedAt)
    await this.store.appendAuditEvent?.({
      actorType: 'user',
      actorId: user.id,
      userId: user.id,
      eventType: 'auth.password_changed',
      createdAt: changedAt
    })
    return { ok: true }
  }

  async listDevices(accessToken: string): Promise<Phase1Device[]> {
    const claims = await this.verifyAccessToken(accessToken)
    return this.store.listDevices(claims.userId)
  }

  async updateDeviceName(
    accessToken: string,
    deviceId: string,
    name: string
  ): Promise<Phase1Device> {
    const claims = await this.verifyAccessToken(accessToken)
    const device = await this.store.updateDeviceName(claims.userId, deviceId, name)
    if (!device) throw new Error('device not found')
    return device
  }

  async listSessions(accessToken: string) {
    const claims = await this.verifyAccessToken(accessToken)
    return (await this.store.listRefreshSessions(claims.userId)).map(publicSession)
  }

  async revokeSession(accessToken: string, sessionId: string): Promise<void> {
    const claims = await this.verifyAccessToken(accessToken)
    const session = await this.store.getRefreshSessionById(sessionId)
    if (!session || session.userId !== claims.userId) throw new Error('refresh session not found')
    await this.store.deactivateRefreshSession(sessionId, this.now().toISOString())
  }

  async revokeDevice(accessToken: string, deviceId: string): Promise<void> {
    const claims = await this.verifyAccessToken(accessToken)
    const device = await this.store.getDevice(deviceId)
    if (!device || device.userId !== claims.userId) throw new Error('device not found')
    const createdAt = this.now().toISOString()
    await this.store.revokeDevice(claims.userId, deviceId, createdAt)
    await this.store.appendControlEvent?.({
      userId: claims.userId,
      targetDeviceId: deviceId,
      type: 'device_revoked',
      createdAt
    })
    await this.store.appendAuditEvent?.({
      actorType: 'user',
      actorId: claims.userId,
      userId: claims.userId,
      eventType: 'device.revoked',
      metadata: { targetDeviceId: deviceId },
      createdAt
    })
  }

  private issueSessionTokens(session: Phase1RefreshSession, refreshToken: string) {
    const expiresAtMs = this.now().getTime() + this.accessTokenTtlMs
    return {
      sessionId: session.id,
      accessToken: makeAccessToken(
        {
          userId: session.userId,
          deviceId: session.deviceId,
          sessionId: session.id,
          expiresAt: expiresAtMs
        },
        this.accessTokenSecret
      ),
      refreshToken,
      expiresAt: new Date(expiresAtMs).toISOString()
    }
  }

  private async requireActiveDevice(userId: string, deviceId: string): Promise<Phase1Device> {
    const device = await this.store.getDevice(deviceId)
    if (!device || device.userId !== userId) throw new Error('device not found')
    if (device.revokedAt) throw new Error('device revoked')
    return device
  }
}

export function createInMemoryPhase1Store(): Phase1Store {
  const users = new Map<string, Phase1User>()
  const usersByEmail = new Map<string, string>()
  const verificationTokens = new Map<string, EmailVerificationToken>()
  const devices = new Map<string, Phase1Device>()
  const sessions = new Map<string, Phase1RefreshSession>()
  const sessionsByTokenHash = new Map<string, string>()
  const auditEvents: AuditEventRecord[] = []

  return {
    createUser(input) {
      const user = { id: randomId('usr'), emailVerifiedAt: null, ...input }
      users.set(user.id, user)
      usersByEmail.set(user.email, user.id)
      return user
    },
    getUserByEmail(email) {
      const id = usersByEmail.get(email)
      return id ? users.get(id) : undefined
    },
    getUserById(id) {
      return users.get(id)
    },
    updateUserPassword(userId, passwordHash) {
      const user = users.get(userId)
      if (!user) return false
      user.passwordHash = passwordHash
      return true
    },
    createEmailVerificationToken(input) {
      verificationTokens.set(input.tokenHash, { ...input, consumedAt: null })
    },
    consumeEmailVerificationToken(tokenHash, consumedAt) {
      const token = verificationTokens.get(tokenHash)
      if (!token || token.consumedAt || token.expiresAt <= consumedAt) return undefined
      token.consumedAt = consumedAt
      return token.userId
    },
    markUserEmailVerified(userId, verifiedAt) {
      const user = users.get(userId)
      if (!user) return undefined
      user.emailVerifiedAt = verifiedAt
      return user
    },
    createDevice(input) {
      const device: Phase1Device = {
        id: randomId('dev'),
        userId: input.userId,
        name: input.name,
        platform: input.platform ?? 'desktop',
        appVersion: input.appVersion ?? 'unknown',
        createdAt: input.createdAt,
        lastSeenAt: null,
        revokedAt: null
      }
      devices.set(device.id, device)
      return device
    },
    getDevice(id) {
      return devices.get(id)
    },
    listDevices(userId) {
      return [...devices.values()].filter((device) => device.userId === userId)
    },
    touchDevice(deviceId, lastSeenAt) {
      const device = devices.get(deviceId)
      if (device) device.lastSeenAt = lastSeenAt
    },
    updateDeviceName(userId, deviceId, name) {
      const device = devices.get(deviceId)
      if (!device || device.userId !== userId) return undefined
      device.name = name
      return device
    },
    revokeDevice(userId, deviceId, revokedAt) {
      const device = devices.get(deviceId)
      if (!device || device.userId !== userId) return
      device.revokedAt = revokedAt
      for (const session of sessions.values()) {
        if (session.userId === userId && session.deviceId === deviceId) {
          session.active = false
          session.rotatedAt = revokedAt
        }
      }
    },
    createRefreshSession(input) {
      const session: Phase1RefreshSession = {
        id: randomId('rfs'),
        userId: input.userId,
        deviceId: input.deviceId,
        refreshTokenHash: input.refreshTokenHash,
        active: true,
        createdAt: input.createdAt,
        rotatedAt: null
      }
      sessions.set(session.id, session)
      sessionsByTokenHash.set(session.refreshTokenHash, session.id)
      return session
    },
    getRefreshSessionByTokenHash(refreshTokenHash) {
      const id = sessionsByTokenHash.get(refreshTokenHash)
      return id ? sessions.get(id) : undefined
    },
    getRefreshSessionById(id) {
      return sessions.get(id)
    },
    listRefreshSessions(userId) {
      return [...sessions.values()].filter((session) => session.userId === userId)
    },
    deactivateRefreshSession(id, rotatedAt) {
      const session = sessions.get(id)
      if (!session) return
      session.active = false
      session.rotatedAt = rotatedAt
    },
    deactivateRefreshSessions(userId, rotatedAt) {
      for (const session of sessions.values()) {
        if (session.userId === userId && session.active) {
          session.active = false
          session.rotatedAt = rotatedAt
        }
      }
    },
    rotateRefreshSession(input) {
      const old = sessions.get(input.oldSessionId)
      if (!old || !old.active || old.userId !== input.userId || old.deviceId !== input.deviceId) {
        return undefined
      }
      old.active = false
      old.rotatedAt = input.rotatedAt
      const next: Phase1RefreshSession = {
        id: randomId('rfs'),
        userId: input.userId,
        deviceId: input.deviceId,
        refreshTokenHash: input.refreshTokenHash,
        active: true,
        createdAt: input.createdAt,
        rotatedAt: null
      }
      sessions.set(next.id, next)
      sessionsByTokenHash.set(next.refreshTokenHash, next.id)
      return next
    },
    appendAuditEvent(event) {
      auditEvents.push({ id: randomId('audit'), ...event })
    },
    listAuditEvents(limit) {
      return auditEvents.slice(-limit).reverse()
    }
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function randomId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString('hex')}`
}

function randomToken(): string {
  return randomBytes(32).toString('base64url')
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 32).toString('hex')
  return `scrypt:${salt}:${hash}`
}

function verifyPassword(password: string, stored: string): boolean {
  const [, salt, expectedHex] = stored.split(':')
  if (!salt || !expectedHex) return false
  const actual = Buffer.from(scryptSync(password, salt, 32).toString('hex'))
  const expected = Buffer.from(expectedHex)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function makeAccessToken(claims: AccessTokenClaims, secret: string): string {
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url')
  return `${payload}.${signAccessToken(payload, secret)}`
}

function parseAccessToken(token: string, secret: string): AccessTokenClaims {
  try {
    const [payload, signature] = token.split('.')
    if (!payload || !signature) throw new Error('invalid access token')
    const expected = Buffer.from(signAccessToken(payload, secret), 'base64url')
    const actual = Buffer.from(signature, 'base64url')
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new Error('invalid access token')
    }
    const claims = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8')
    ) as AccessTokenClaims
    if (
      typeof claims.userId !== 'string' ||
      typeof claims.deviceId !== 'string' ||
      typeof claims.sessionId !== 'string' ||
      typeof claims.expiresAt !== 'number'
    ) {
      throw new Error('invalid access token')
    }
    return claims
  } catch {
    throw new Error('invalid access token')
  }
}

function signAccessToken(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

function publicSession(session: Phase1RefreshSession) {
  return {
    id: session.id,
    deviceId: session.deviceId,
    active: session.active,
    createdAt: session.createdAt,
    rotatedAt: session.rotatedAt
  }
}
