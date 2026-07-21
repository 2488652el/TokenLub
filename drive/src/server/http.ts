import { randomUUID } from 'node:crypto'
import type { Phase1AuthService } from './phase1'
import type { DataControlService } from './data-control'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createServerMetrics } from './metrics'
import { createHash } from 'node:crypto'
import { createRateLimiter, RateLimitError, type RateLimitOptions } from './rate-limit'
import type { AdminAuthenticator } from './admin-auth'
import type { AuditEventRecord } from './phase1'
import {
  MAX_SYNC_V2_BYTES,
  SYNC_V2_PROTOCOL_VERSION,
  type SyncV2Snapshot
} from '../../../code/src/shared/sync-v2'
import type { SnapshotSyncService } from './snapshot-sync'
import type { BindingTicketService } from './binding-ticket'

export type HttpLogEntry = {
  level: 'info' | 'warn' | 'error'
  event: string
  traceId: string
  method: string
  path: string
  status: number
  error?: string
}

type HandlerOptions = {
  auth: Phase1AuthService
  snapshotSync?: SnapshotSyncService
  data?: DataControlService
  log?: (entry: HttpLogEntry) => void
  traceId?: () => string
  metrics?: ReturnType<typeof createServerMetrics>
  rateLimit?: RateLimitOptions
  admin?: AdminAuthenticator
  audit?: { list(limit: number): Promise<AuditEventRecord[]> }
  storage?: () => Promise<{
    databaseBytes: number
    syncChangesBytes: number
    queueBacklog: number
    clientVersions: Record<string, number>
  }>
  health?: () => Promise<void>
  corsOrigin?: string
  bindingTickets?: BindingTicketService
}

type RequestContext = {
  request: Request
  url: URL
  traceId: string
}

export function createPhase1HttpHandler(
  options: HandlerOptions
): (request: Request) => Promise<Response> {
  const traceId = options.traceId ?? randomUUID
  const metrics = options.metrics ?? createServerMetrics()
  const limiter = createRateLimiter(options.rateLimit ?? { max: 120, windowMs: 60_000 })

  return async (request: Request): Promise<Response> => {
    const startedAt = Date.now()
    const url = new URL(request.url)
    const ctx: RequestContext = { request, url, traceId: traceId() }

    try {
      if (url.pathname.startsWith('/v1/sync/') || url.pathname.startsWith('/v1/data/')) {
        const bearer =
          request.headers.get('authorization') ??
          request.headers.get('x-forwarded-for') ??
          'anonymous'
        const key = createHash('sha256').update(bearer).digest('hex').slice(0, 16)
        limiter.check(`${key}:${url.pathname.split('/').slice(0, 3).join('/')}`)
      }
      const response = await route(ctx, options, metrics)
      metrics.record(request.method, url.pathname, response.status, Date.now() - startedAt)
      options.log?.({
        level: 'info',
        event: 'http.request',
        traceId: ctx.traceId,
        method: request.method,
        path: url.pathname,
        status: response.status
      })
      return withTrace(applyCors(response, requestOrigin(request), options.corsOrigin), ctx.traceId)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'request failed'
      const status = statusForError(error, message)
      metrics.record(request.method, url.pathname, status, Date.now() - startedAt)
      options.log?.({
        level: status >= 500 ? 'error' : 'warn',
        event: 'http.request_failed',
        traceId: ctx.traceId,
        method: request.method,
        path: url.pathname,
        status,
        error: redactError(message)
      })
      const body = { error: errorCode(status), message: safeMessage(status, message) }
      const response = withTrace(json(body, status), ctx.traceId)
      if (error instanceof RateLimitError) {
        response.headers.set('retry-after', String(error.retryAfterSeconds))
      }
      return response
    }
  }
}

async function route(
  ctx: RequestContext,
  options: HandlerOptions,
  metrics: ReturnType<typeof createServerMetrics>
): Promise<Response> {
  if (ctx.request.method === 'OPTIONS') return new Response(null, { status: 204 })
  if (
    ctx.request.method === 'GET' &&
    (ctx.url.pathname === '/console/moonmeter-icon.png' ||
      ctx.url.pathname === '/console/tokenlub-mark.png')
  ) {
    return new Response(
      new Uint8Array(readFileSync(resolve('code/src/renderer/assets/moonmeter-icon.png'))),
      {
        headers: {
          'cache-control': 'public, max-age=86400',
          'content-type': 'image/png',
          'x-content-type-options': 'nosniff'
        }
      }
    )
  }
  if (ctx.request.method === 'GET' && ctx.url.pathname === '/console') {
    return new Response(readFileSync(resolve('drive/src/server/console/index.html'), 'utf8'), {
      headers: {
        'cache-control': 'no-store',
        'content-security-policy':
          "default-src 'self'; img-src 'self' data:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' http: https:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
        'content-type': 'text/html; charset=utf-8',
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'DENY'
      }
    })
  }
  if (ctx.request.method === 'GET' && ctx.url.pathname === '/healthz') {
    if (options.health) {
      try {
        await options.health()
      } catch {
        return json({ ok: false, phase: 1 }, 503)
      }
    }
    return json({ ok: true, phase: 1 })
  }
  if (ctx.request.method === 'GET' && ctx.url.pathname === '/metrics') {
    if (!options.admin) return json({ error: 'not_found' }, 404)
    await requireAdmin(options, ctx.request)
    return json(metrics.snapshot())
  }
  if (ctx.request.method === 'GET' && ctx.url.pathname === '/v1/admin/metrics') {
    if (!options.admin) return json({ error: 'not_found' }, 404)
    await requireAdmin(options, ctx.request)
    return json({
      ...metrics.snapshot(),
      ...(options.storage ? await options.storage() : {})
    })
  }
  if (ctx.request.method === 'GET' && ctx.url.pathname === '/v1/admin/audit-events') {
    if (!options.admin) return json({ error: 'not_found' }, 404)
    await requireAdmin(options, ctx.request)
    if (!options.audit) return json({ error: 'not_found' }, 404)
    const requested = Number(ctx.url.searchParams.get('limit') ?? 100)
    const limit = Number.isInteger(requested) ? Math.min(Math.max(requested, 1), 100) : 100
    return json((await options.audit.list(limit)).map(redactAuditEvent))
  }
  if (ctx.request.method === 'GET' && ctx.url.pathname === '/v1/devices') {
    return json(await options.auth.listDevices(readBearer(ctx.request)))
  }

  if (ctx.request.method === 'GET' && ctx.url.pathname === '/v1/account/sessions') {
    return json(await options.auth.listSessions(readBearer(ctx.request)))
  }

  const sessionPath = ctx.url.pathname.match(/^\/v1\/account\/sessions\/([^/]+)$/)
  if (ctx.request.method === 'DELETE' && sessionPath) {
    await options.auth.revokeSession(
      readBearer(ctx.request),
      decodeURIComponent(sessionPath[1] ?? '')
    )
    return json({ ok: true })
  }

  const devicePath = ctx.url.pathname.match(/^\/v1\/devices\/([^/]+)$/)
  if (ctx.request.method === 'PATCH' && devicePath) {
    const body = await readJson(ctx.request)
    return json(
      await options.auth.updateDeviceName(
        readBearer(ctx.request),
        decodeURIComponent(devicePath[1] ?? ''),
        readString(body, 'name')
      )
    )
  }
  if (ctx.request.method === 'DELETE' && devicePath) {
    const deviceId = devicePath[1]
    if (!deviceId) return json({ error: 'not_found' }, 404)
    await options.auth.revokeDevice(readBearer(ctx.request), decodeURIComponent(deviceId))
    return json({ ok: true })
  }

  if (ctx.request.method === 'GET' && ctx.url.pathname === '/v1/sync/summary') {
    if (!options.snapshotSync) throw new Error('sync v2 is unavailable')
    const claims = await options.auth.verifyAccessToken(readBearer(ctx.request))
    return json(await options.snapshotSync.status(claims))
  }

  if (ctx.request.method === 'GET' && ctx.url.pathname === '/v1/sync/status') {
    if (!options.snapshotSync) throw new Error('sync v2 is unavailable')
    const claims = await options.auth.verifyAccessToken(readBearer(ctx.request))
    return json(await options.snapshotSync.status(claims))
  }

  if (ctx.request.method === 'GET' && ctx.url.pathname === '/v1/data/statistics') {
    if (!options.snapshotSync) throw new Error('sync v2 is unavailable')
    const claims = await options.auth.verifyAccessToken(readBearer(ctx.request))
    return json(await options.snapshotSync.status(claims))
  }

  if (ctx.request.method === 'POST' && ctx.url.pathname === '/v1/data/export') {
    if (!options.data) throw new Error('data control unavailable')
    const claims = await options.auth.verifyAccessToken(readBearer(ctx.request))
    return json(await options.data.request(claims.userId, 'export'), 202)
  }

  if (ctx.request.method === 'POST' && ctx.url.pathname === '/v1/account/password') {
    const body = await readJson(ctx.request)
    return json(
      await options.auth.changePassword({
        accessToken: readBearer(ctx.request),
        currentPassword: readString(body, 'currentPassword'),
        newPassword: readString(body, 'newPassword')
      })
    )
  }

  const taskPath = ctx.url.pathname.match(/^\/v1\/data\/(export|delete)\/([^/]+)$/)
  if (ctx.request.method === 'GET' && taskPath) {
    if (!options.data) throw new Error('data control unavailable')
    const claims = await options.auth.verifyAccessToken(readBearer(ctx.request))
    const task = await options.data.get(claims.userId, decodeURIComponent(taskPath[2] ?? ''))
    if (!task) return json({ error: 'not_found' }, 404)
    return json(task)
  }

  if (ctx.request.method === 'DELETE' && ctx.url.pathname === '/v1/data/cloud') {
    if (!options.data) throw new Error('data control unavailable')
    const body = await readJson(ctx.request)
    if (body.confirmation !== 'DELETE_CLOUD_DATA') throw new Error('confirmation required')
    const claims = await options.auth.verifyAccessToken(readBearer(ctx.request))
    return json(await options.data.request(claims.userId, 'delete'), 202)
  }

  if (
    (ctx.request.method === 'GET' || ctx.request.method === 'POST') &&
    ctx.url.pathname === '/v1/auth/verify-email'
  ) {
    const token =
      ctx.request.method === 'GET'
        ? ctx.url.searchParams.get('token')
        : readString(await readJson(ctx.request), 'token')
    if (!token) throw new Error('token is required')
    return json(await options.auth.verifyEmail(token))
  }

  if (ctx.request.method !== 'POST') {
    return json({ error: 'not_found' }, 404)
  }

  if (ctx.url.pathname === '/v1/devices') {
    const body = await readJson(ctx.request)
    const platform = readOptionalString(body, 'platform')
    const appVersion = readOptionalString(body, 'appVersion')
    const device = await options.auth.registerDeviceForAccessToken(
      readBearer(ctx.request),
      readString(body, 'name'),
      platform ?? 'desktop',
      appVersion ?? 'unknown'
    )
    return json(device, 201)
  }

  if (ctx.url.pathname === '/v1/auth/register') {
    const body = await readJson(ctx.request)
    const platform = readOptionalString(body, 'platform')
    const appVersion = readOptionalString(body, 'appVersion')
    const user = await options.auth.registerUser({
      email: readString(body, 'email'),
      password: readString(body, 'password')
    })
    const device = await options.auth.registerDevice({
      userId: user.id,
      deviceName: readString(body, 'deviceName'),
      ...(platform ? { platform } : {}),
      ...(appVersion ? { appVersion } : {})
    })
    if (options.auth.emailVerificationRequired) {
      return json({ userId: user.id, deviceId: device.id, verificationRequired: true }, 202)
    }
    const session = await options.auth.login({
      email: readString(body, 'email'),
      password: readString(body, 'password'),
      deviceId: device.id
    })
    return json({ userId: user.id, deviceId: device.id, ...session }, 201)
  }

  if (ctx.url.pathname === '/v1/auth/login') {
    const body = await readJson(ctx.request)
    const deviceId = readString(body, 'deviceId')
    const session = await options.auth.login({
      email: readString(body, 'email'),
      password: readString(body, 'password'),
      deviceId
    })
    return json({ deviceId, ...session })
  }

  if (ctx.url.pathname === '/v1/auth/binding-ticket') {
    if (!options.bindingTickets) throw new Error('app binding is unavailable')
    const claims = await options.auth.verifyAccessToken(readBearer(ctx.request))
    return json(options.bindingTickets.create(claims.userId), 201)
  }

  if (ctx.url.pathname === '/v1/auth/bind') {
    if (!options.bindingTickets) throw new Error('app binding is unavailable')
    const body = await readJson(ctx.request)
    const userId = options.bindingTickets.consume(readString(body, 'ticket'))
    const device = await options.auth.registerDevice({
      userId,
      deviceName: readString(body, 'deviceName'),
      platform: readOptionalString(body, 'platform') ?? 'desktop',
      appVersion: readOptionalString(body, 'appVersion') ?? 'unknown'
    })
    const session = await options.auth.createSessionForDevice(userId, device.id, true)
    return json({ deviceId: device.id, ...session }, 201)
  }

  if (ctx.url.pathname === '/v1/auth/refresh') {
    const body = await readJson(ctx.request)
    const deviceId = readString(body, 'deviceId')
    const session = await options.auth.refresh({
      refreshToken: readString(body, 'refreshToken'),
      deviceId
    })
    return json({ deviceId, ...session })
  }

  if (ctx.url.pathname === '/v1/auth/logout') {
    const body = await readJson(ctx.request)
    await options.auth.logout({
      accessToken: readBearer(ctx.request),
      deviceId: readString(body, 'deviceId')
    })
    return json({ ok: true })
  }

  if (ctx.url.pathname === '/v1/sync/exchange') {
    if (!options.snapshotSync) throw new Error('sync v2 is unavailable')
    const body = await readJson(ctx.request, MAX_SYNC_V2_BYTES)
    if (body.protocolVersion !== SYNC_V2_PROTOCOL_VERSION) {
      throw new Error('unsupported sync protocol')
    }
    const deviceId = readString(body, 'deviceId')
    const claims = await options.auth.verifyAccessToken(readBearer(ctx.request), deviceId)
    const strategy = body.strategy
    if (strategy !== 'merge' && strategy !== 'upload' && strategy !== 'restore') {
      throw new Error('invalid sync strategy')
    }
    const snapshot = body.snapshot
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      throw new Error('invalid sync snapshot')
    }
    return json(
      await options.snapshotSync.exchange({
        userId: claims.userId,
        deviceId,
        baseRevision: readNonNegativeNumber(body, 'baseRevision'),
        strategy,
        snapshot: snapshot as SyncV2Snapshot
      })
    )
  }

  return json({ error: 'not_found' }, 404)
}

async function requireAdmin(options: HandlerOptions, request: Request): Promise<void> {
  if (!options.admin) throw new Error('admin authentication unavailable')
  await options.admin.verify(request)
}

function redactAuditEvent(event: AuditEventRecord): AuditEventRecord {
  return { ...event, metadata: redactMetadata(event.metadata ?? {}) }
}

function redactMetadata(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      /token|secret|password|api.?key|authorization|raw.?json/i.test(key)
        ? '[redacted]'
        : redactValue(entry)
    ])
  )
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue)
  if (value && typeof value === 'object') return redactMetadata(value as Record<string, unknown>)
  return value
}

async function readJson(request: Request, maxBytes = 256 * 1024): Promise<Record<string, unknown>> {
  try {
    const text = await request.text()
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new Error('request body too large')
    }
    const body = JSON.parse(text) as unknown
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new Error('invalid json body')
    return body as Record<string, unknown>
  } catch (error) {
    if (error instanceof Error && error.message === 'request body too large') throw error
    throw new Error('invalid json body')
  }
}

function readString(body: Record<string, unknown>, key: string): string {
  const value = body[key]
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${key} is required`)
  return value
}

function readOptionalString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${key} must be a string`)
  return value
}

function readNonNegativeNumber(body: Record<string, unknown>, key: string): number {
  const value = body[key]
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${key} must be a non-negative integer`)
  }
  return value
}

function readBearer(request: Request): string {
  const value = request.headers.get('authorization') ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(value)
  if (!match?.[1]) throw new Error('missing bearer token')
  return match[1]
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

function requestOrigin(request: Request): string | null {
  return request.headers.get('origin')
}

function applyCors(response: Response, origin: string | null, allowedOrigin?: string): Response {
  if (!origin || !allowedOrigin || origin !== allowedOrigin) return response
  const headers = new Headers(response.headers)
  headers.set('access-control-allow-origin', allowedOrigin)
  headers.set('access-control-allow-methods', 'GET,POST,PATCH,DELETE,OPTIONS')
  headers.set('access-control-allow-headers', 'authorization,content-type')
  headers.set('access-control-max-age', '600')
  headers.set('vary', 'Origin')
  return new Response(response.body, { status: response.status, headers })
}

function withTrace(response: Response, traceId: string): Response {
  response.headers.set('x-trace-id', traceId)
  return response
}

function statusForError(error: unknown, message: string): number {
  if (error instanceof RateLimitError) return 429
  if (message.includes('request body too large')) return 413
  if (message.includes('invalid email verification token')) return 400
  if (
    message.includes('token') ||
    message.includes('credentials') ||
    message.includes('refresh session') ||
    message.includes('admin authentication') ||
    message.includes('device mismatch') ||
    message.includes('device not found') ||
    message.includes('device revoked') ||
    message.includes('binding ticket')
  ) {
    return 401
  }
  return 400
}

function errorCode(status: number): string {
  if (status === 429) return 'rate_limited'
  if (status === 413) return 'payload_too_large'
  return status === 401 ? 'unauthorized' : 'bad_request'
}

function safeMessage(status: number, message: string): string {
  return status === 401 ? 'authentication required' : redactError(message)
}

function redactError(message: string): string {
  return message
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/[A-Za-z0-9_-]{24,}/g, '[redacted]')
}
