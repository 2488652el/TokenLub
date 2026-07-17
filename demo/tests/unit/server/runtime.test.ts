import { describe, expect, it, vi } from 'vitest'

const migrationClient = { query: vi.fn(), release: vi.fn() }
const pool = { query: vi.fn(), connect: vi.fn(async () => migrationClient), on: vi.fn() }
const Pool = vi.fn(() => pool)
vi.mock('pg', () => ({ Pool }))

describe('phase1 server runtime', () => {
  it('validates deployment configuration with safe defaults', async () => {
    const { readPhase1Config } = await import('../../../../drive/src/server/config')

    expect(
      readPhase1Config({
        DATABASE_URL: 'postgres://sync:test@localhost/tokenlub',
        ACCESS_TOKEN_SECRET: 'a'.repeat(32)
      })
    ).toEqual({
      databaseUrl: 'postgres://sync:test@localhost/tokenlub',
      port: 3000,
      accessTokenTtlMs: 900_000,
      accessTokenSecret: 'a'.repeat(32),
      syncRateLimitPerMinute: 120
    })
    expect(() => readPhase1Config({})).toThrow(/DATABASE_URL/)
    expect(() =>
      readPhase1Config({ DATABASE_URL: 'postgres://localhost/db', PORT: '70000' })
    ).toThrow(/PORT/)
    expect(
      readPhase1Config({
        DATABASE_URL: 'postgres://localhost/db',
        ACCESS_TOKEN_SECRET: 'a'.repeat(32),
        ADMIN_EMAIL: 'Owner@Example.com'
      }).adminEmail
    ).toBe('owner@example.com')
    expect(() =>
      readPhase1Config({
        DATABASE_URL: 'postgres://localhost/db',
        ACCESS_TOKEN_SECRET: 'a'.repeat(32),
        ADMIN_EMAIL: 'not-an-email'
      })
    ).toThrow(/ADMIN_EMAIL/)

    expect(
      readPhase1Config({
        DATABASE_URL: 'postgres://localhost/db',
        ACCESS_TOKEN_SECRET: 'a'.repeat(32),
        EMAIL_VERIFICATION_REQUIRED: 'true',
        PUBLIC_BASE_URL: 'https://sync.example.com',
        SMTP_HOST: 'smtp.example.com',
        SMTP_PORT: '587',
        SMTP_SECURE: 'false',
        SMTP_USER: 'mailer',
        SMTP_PASSWORD: 'secret',
        SMTP_FROM: 'TokenLub <no-reply@example.com>',
        CONSOLE_ORIGIN: 'https://console.example.com'
      }).smtp
    ).toEqual({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      user: 'mailer',
      password: 'secret',
      from: 'TokenLub <no-reply@example.com>',
      publicBaseUrl: 'https://sync.example.com'
    })
    expect(
      readPhase1Config({
        DATABASE_URL: 'postgres://localhost/db',
        ACCESS_TOKEN_SECRET: 'a'.repeat(32),
        CONSOLE_ORIGIN: 'https://console.example.com'
      }).consoleOrigin
    ).toBe('https://console.example.com')
    expect(() =>
      readPhase1Config({
        DATABASE_URL: 'postgres://localhost/db',
        ACCESS_TOKEN_SECRET: 'a'.repeat(32),
        CONSOLE_ORIGIN: 'https://console.example.com/app'
      })
    ).toThrow(/console origin must not include a path/)
    expect(() =>
      readPhase1Config({
        DATABASE_URL: 'postgres://localhost/db',
        ACCESS_TOKEN_SECRET: 'a'.repeat(32),
        EMAIL_VERIFICATION_REQUIRED: 'true'
      })
    ).toThrow(/SMTP and PUBLIC_BASE_URL configuration is incomplete/)
  })

  it('creates a fetch handler over the Postgres pool without exposing pool credentials', async () => {
    const { createPhase1Runtime, createPhase1NodeServer, startPhase1Server } =
      await import('../../../../drive/src/server/runtime')
    const runtime = createPhase1Runtime({
      databaseUrl: 'postgres://sync:test@localhost/tokenlub',
      accessTokenSecret: 'a'.repeat(32),
      now: () => new Date('2026-07-13T00:00:00.000Z')
    })

    const response = await runtime.handle(new Request('https://sync.local/healthz'))

    expect(response.status).toBe(200)
    expect(Pool).toHaveBeenCalledWith({
      connectionString: 'postgres://sync:test@localhost/tokenlub'
    })
    expect(pool.on).toHaveBeenCalledWith('error', expect.any(Function))
    pool.on.mock.calls.at(-1)?.[1](new Error('connection lost'))
    expect(runtime.metrics.snapshot().counters.database_pool_errors).toBe(1)

    const server = createPhase1NodeServer(runtime)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('expected TCP server address')
      await expect(fetch(`http://127.0.0.1:${address.port}/healthz`)).resolves.toMatchObject({
        status: 200
      })
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
    }

    migrationClient.query.mockClear()
    const started = await startPhase1Server({
      databaseUrl: 'postgres://sync:test@localhost/tokenlub',
      port: 0,
      host: '127.0.0.1'
    })
    expect(migrationClient.query).toHaveBeenCalledWith(
      expect.stringContaining('CREATE TABLE IF NOT EXISTS users')
    )
    await new Promise<void>((resolve, reject) =>
      started.server.close((error) => (error ? reject(error) : resolve()))
    )
  })

  it('compresses large JSON responses only when gzip is accepted', async () => {
    const { createPhase1NodeServer } = await import('../../../../drive/src/server/runtime')
    const server = createPhase1NodeServer({
      handle: async () =>
        new Response(JSON.stringify({ payload: 'x'.repeat(2_000) }), {
          headers: { 'content-type': 'application/json' }
        })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('expected TCP server address')
      const response = await fetch(`http://127.0.0.1:${address.port}/data`, {
        headers: { 'accept-encoding': 'gzip' }
      })
      expect(response.headers.get('content-encoding')).toBe('gzip')
      await expect(response.json()).resolves.toMatchObject({ payload: expect.any(String) })
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
    }
  })

  it('rejects oversized request bodies before invoking the fetch handler', async () => {
    const { createPhase1NodeServer } = await import('../../../../drive/src/server/runtime')
    const handle = vi.fn(async () => new Response('ok'))
    const server = createPhase1NodeServer({ handle })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('expected TCP server address')
      const response = await fetch(`http://127.0.0.1:${address.port}/v1/sync/exchange`, {
        method: 'POST',
        body: 'x'.repeat(2 * 1024 * 1024 + 1)
      })

      expect(response.status).toBe(413)
      expect(handle).not.toHaveBeenCalled()
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
    }
  })

  it('forwards and closes event streams', async () => {
    const { createPhase1NodeServer } = await import('../../../../drive/src/server/runtime')
    const server = createPhase1NodeServer({
      handle: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('event: sync\n\n'))
              controller.close()
            }
          }),
          { headers: { 'content-type': 'text/event-stream' } }
        )
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('expected TCP server address')
      const response = await fetch(`http://127.0.0.1:${address.port}/events`)
      expect(response.headers.get('content-type')).toBe('text/event-stream')
      await expect(response.text()).resolves.toBe('event: sync\n\n')
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
    }
  })
})
