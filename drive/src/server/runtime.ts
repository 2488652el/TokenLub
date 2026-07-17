import { createServer, type IncomingMessage, type Server } from 'node:http'
import { Pool } from 'pg'
import { createPhase1HttpHandler, type HttpLogEntry } from './http'
import { Phase1AuthService } from './phase1'
import { PostgresPhase1Store } from './postgres-store'
import { runPhase1MigrationsInTransaction } from './migrations'
import { DataControlService } from './data-control'
import type { RateLimitOptions } from './rate-limit'
import { gzip } from 'node:zlib'
import { MAX_SYNC_V2_BYTES } from '../../../code/src/shared/sync-v2'
import { promisify } from 'node:util'
import { createOwnerAdminAuthenticator } from './admin-auth'
import { createServerMetrics } from './metrics'
import { SnapshotSyncService } from './snapshot-sync'
import { BindingTicketService } from './binding-ticket'

const gzipAsync = promisify(gzip)
const COMPRESSION_THRESHOLD = 1024

export type Phase1RuntimeOptions = {
  databaseUrl: string
  accessTokenTtlMs?: number
  accessTokenSecret?: string
  now?: () => Date
  log?: (entry: HttpLogEntry) => void
  syncRateLimitPerMinute?: number
  adminEmail?: string
  emailVerificationRequired?: boolean
  sendVerificationEmail?: (input: { email: string; token: string }) => Promise<unknown>
  corsOrigin?: string
}

export function createPhase1Runtime(options: Phase1RuntimeOptions) {
  const metrics = createServerMetrics()
  const pool = new Pool({ connectionString: options.databaseUrl })
  pool.on('error', () => metrics.increment('database_pool_errors'))
  const store = new PostgresPhase1Store(pool)
  const authOptions = {
    store,
    ...(options.now ? { now: options.now } : {}),
    ...(options.accessTokenTtlMs ? { accessTokenTtlMs: options.accessTokenTtlMs } : {}),
    ...(options.accessTokenSecret ? { accessTokenSecret: options.accessTokenSecret } : {}),
    ...(options.emailVerificationRequired ? { requireEmailVerification: true } : {}),
    ...(options.sendVerificationEmail
      ? {
          sendVerificationEmail: async (input: { email: string; token: string }) => {
            await options.sendVerificationEmail!(input)
          }
        }
      : {})
  }
  const auth = new Phase1AuthService(authOptions)
  const snapshotSync = new SnapshotSyncService({
    store,
    ...(options.now ? { now: options.now } : {})
  })
  const data = new DataControlService(store)
  const bindingTickets = new BindingTicketService({
    ...(options.now ? { now: () => options.now!().getTime() } : {})
  })
  const admin = options.adminEmail
    ? createOwnerAdminAuthenticator({ auth, store, ownerEmail: options.adminEmail })
    : undefined
  const handle = createPhase1HttpHandler({
    auth,
    snapshotSync,
    data,
    bindingTickets,
    metrics,
    health: async () => {
      await pool.query('SELECT 1')
    },
    ...(options.corsOrigin ? { corsOrigin: options.corsOrigin } : {}),
    audit: { list: (limit) => store.listAuditEvents?.(limit) ?? Promise.resolve([]) },
    storage: () => store.getOperationalMetrics(),
    ...(admin ? { admin } : {}),
    ...(options.syncRateLimitPerMinute
      ? {
          rateLimit: {
            max: options.syncRateLimitPerMinute,
            windowMs: 60_000
          } satisfies RateLimitOptions
        }
      : {}),
    ...(options.log ? { log: options.log } : {})
  })
  return { pool, handle, store, metrics }
}

export function createPhase1NodeServer(runtime: {
  handle(request: Request): Promise<Response>
}): Server {
  return createServer(async (incoming, outgoing) => {
    try {
      const request = await toRequest(incoming)
      const response = await runtime.handle(request)
      response.headers.forEach((value, key) => outgoing.setHeader(key, value))
      outgoing.statusCode = response.status
      if (response.headers.get('content-type') === 'text/event-stream' && response.body) {
        const reader = response.body.getReader()
        const cancel = () => void reader.cancel()
        outgoing.once('close', cancel)
        outgoing.flushHeaders()
        try {
          while (true) {
            const chunk = await reader.read()
            if (chunk.done) break
            outgoing.write(Buffer.from(chunk.value))
          }
        } finally {
          outgoing.removeListener('close', cancel)
          outgoing.end()
        }
        return
      }
      const body = Buffer.from(await response.arrayBuffer())
      const acceptsGzip = /\bgzip\b/i.test(String(incoming.headers['accept-encoding'] ?? ''))
      if (
        acceptsGzip &&
        body.length >= COMPRESSION_THRESHOLD &&
        !response.headers.has('content-encoding')
      ) {
        const compressed = await gzipAsync(body)
        outgoing.setHeader('content-encoding', 'gzip')
        outgoing.setHeader('vary', 'accept-encoding')
        outgoing.setHeader('content-length', compressed.length)
        outgoing.end(compressed)
      } else {
        outgoing.setHeader('content-length', body.length)
        outgoing.end(body)
      }
    } catch (error) {
      outgoing.statusCode = error instanceof RequestBodyTooLargeError ? 413 : 500
      outgoing.end(
        error instanceof RequestBodyTooLargeError
          ? 'request body too large'
          : 'internal server error'
      )
    }
  })
}

export async function startPhase1Server(
  options: Phase1RuntimeOptions & { port: number; host?: string }
) {
  const runtime = createPhase1Runtime(options)
  await runPhase1MigrationsInTransaction(runtime.pool)
  const server = createPhase1NodeServer(runtime)
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(options.port, options.host ?? '0.0.0.0', () => resolve())
    })
  } catch (error) {
    await runtime.pool.end()
    throw error
  }
  return {
    ...runtime,
    server
  }
}

async function toRequest(incoming: IncomingMessage): Promise<Request> {
  const headers = new Headers()
  for (const [key, value] of Object.entries(incoming.headers)) {
    if (value) headers.set(key, Array.isArray(value) ? value.join(',') : value)
  }
  const method = incoming.method ?? 'GET'
  const init: RequestInit = { method, headers }
  if (method !== 'GET' && method !== 'HEAD') {
    const declaredLength = Number(incoming.headers['content-length'])
    if (Number.isFinite(declaredLength) && declaredLength > MAX_SYNC_V2_BYTES) {
      incoming.resume()
      throw new RequestBodyTooLargeError()
    }
    const chunks: Buffer[] = []
    let received = 0
    for await (const chunk of incoming) {
      const buffer = Buffer.from(chunk)
      received += buffer.length
      if (received > MAX_SYNC_V2_BYTES) {
        incoming.resume()
        throw new RequestBodyTooLargeError()
      }
      chunks.push(buffer)
    }
    init.body = Buffer.concat(chunks).toString()
  }
  return new Request(`http://${incoming.headers.host ?? 'localhost'}${incoming.url ?? '/'}`, init)
}

class RequestBodyTooLargeError extends Error {}
