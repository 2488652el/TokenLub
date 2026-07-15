import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { PostgresQueryClient } from './postgres-store'

type TransactionClient = PostgresQueryClient & { release(): void }

export async function runPhase1Migrations(client: PostgresQueryClient): Promise<void> {
  const directory = resolve('src/server/migrations')
  for (const file of readdirSync(directory)
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    await client.query(readFileSync(resolve(directory, file), 'utf8'))
  }
}

export async function runPhase1MigrationsInTransaction(pool: {
  connect(): Promise<TransactionClient>
}): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await runPhase1Migrations(client)
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}
