import { describe, expect, it, vi } from 'vitest'
import {
  runPhase1Migrations,
  runPhase1MigrationsInTransaction
} from '../../../src/server/migrations'

describe('phase1 migrations', () => {
  it('executes checked-in migrations in filename order', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })

    await runPhase1Migrations({ query })

    expect(query).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS users'))
    expect(query).toHaveBeenCalledWith(expect.stringContaining('CREATE UNIQUE INDEX IF NOT EXISTS'))
    expect(query).toHaveBeenCalledWith(expect.stringContaining('sync_conflicts'))
    expect(query).toHaveBeenCalledWith(expect.stringContaining('user_sync_snapshots'))
    expect(query.mock.calls[0]?.[0]).toContain('CREATE TABLE IF NOT EXISTS users')
    expect(query.mock.calls[1]?.[0]).toContain('model_pricing')
  })

  it('wraps production migrations in one transaction and rolls back on failure', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })
    const client = { query, release: vi.fn() }

    await runPhase1MigrationsInTransaction({ connect: async () => client })
    expect(query.mock.calls[0]?.[0]).toBe('BEGIN')
    expect(query.mock.calls.at(-1)?.[0]).toBe('COMMIT')
    expect(client.release).toHaveBeenCalledOnce()

    query.mockReset()
    query.mockImplementationOnce(async () => ({ rows: [] }))
    query.mockImplementationOnce(async () => {
      throw new Error('migration failed')
    })
    query.mockImplementationOnce(async () => ({ rows: [] }))
    await expect(runPhase1MigrationsInTransaction({ connect: async () => client })).rejects.toThrow(
      'migration failed'
    )
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK')
  })

  it('adds device metadata without rebuilding the devices table', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })
    await runPhase1Migrations({ query })
    const metadata = query.mock.calls.find((call) =>
      call[0].includes('ADD COLUMN IF NOT EXISTS platform')
    )
    expect(metadata?.[0]).toContain('app_version')
    expect(metadata?.[0]).toContain('last_seen_at')
  })
})
