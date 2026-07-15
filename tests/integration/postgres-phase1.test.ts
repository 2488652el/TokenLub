import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Phase1AuthService } from '../../src/server/phase1'
import { PostgresPhase1Store } from '../../src/server/postgres-store'
import { runPhase1MigrationsInTransaction } from '../../src/server/migrations'
import { SnapshotSyncService } from '../../src/server/snapshot-sync'

const databaseUrl = process.env.DATABASE_URL
const describeIfDatabase = databaseUrl ? describe : describe.skip

describeIfDatabase('PostgreSQL Sync V2 integration', () => {
  const pool = new Pool({ connectionString: databaseUrl })
  const userIds: string[] = []

  beforeAll(async () => {
    await runPhase1MigrationsInTransaction(pool)
  })

  afterAll(async () => {
    if (userIds.length > 0) {
      await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds])
    }
    await pool.end()
  })

  it('converges two devices through one revisioned snapshot', async () => {
    const store = new PostgresPhase1Store(pool)
    const now = () => new Date('2026-07-13T00:00:00.000Z')
    const auth = new Phase1AuthService({ store, now })
    const sync = new SnapshotSyncService({ store, now })
    const user = await auth.registerUser({
      email: `integration-${randomUUID()}@example.com`,
      password: 'integration-password'
    })
    userIds.push(user.id)
    const deviceA = await auth.registerDevice({ userId: user.id, deviceName: 'A' })
    const deviceB = await auth.registerDevice({ userId: user.id, deviceName: 'B' })
    const first = await sync.exchange({
      userId: user.id,
      deviceId: deviceA.id,
      baseRevision: 0,
      strategy: 'merge',
      snapshot: {
        settings: { refresh_interval_min: 30 },
        pricing: [],
        balances: []
      }
    })
    const restored = await sync.exchange({
      userId: user.id,
      deviceId: deviceB.id,
      baseRevision: 0,
      strategy: 'restore',
      snapshot: { settings: {}, pricing: [], balances: [] }
    })

    expect(first).toMatchObject({ revision: 1, changed: true, accepted: true })
    expect(restored).toMatchObject({
      revision: 1,
      changed: false,
      accepted: false,
      snapshot: { settings: { refresh_interval_min: 30 } }
    })
    await expect(store.getSyncV2Snapshot(user.id)).resolves.toMatchObject({ revision: 1 })
  })
})
