import { test, expect } from '@playwright/test'
import { _electron as electron, type ElectronApplication } from 'playwright'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, existsSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import type { Server } from 'node:http'
import { createPhase1HttpHandler } from '../../../drive/src/server/http'
import { createInMemoryPhase1Store, Phase1AuthService } from '../../../drive/src/server/phase1'
import { createPhase1NodeServer } from '../../../drive/src/server/runtime'
import {
  SnapshotSyncService,
  type StoredSyncV2Snapshot
} from '../../../drive/src/server/snapshot-sync'

const electronPath = createRequire(__filename)('electron') as string
const packageVersion = (createRequire(__filename)('../../package.json') as { version: string })
  .version

async function holdDatabaseLock(databasePath: string): Promise<ChildProcess> {
  const child = spawn(
    electronPath,
    [
      '-e',
      "const Database=require('better-sqlite3'); const db=new Database(process.argv[1]); db.exec('BEGIN EXCLUSIVE'); console.log('locked'); setInterval(()=>{},1000)",
      databasePath
    ],
    { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'pipe', 'inherit'] }
  )
  await new Promise<void>((resolve, reject) => {
    child.stdout?.once('data', (data: Buffer) => {
      if (data.toString().includes('locked')) resolve()
    })
    child.once('error', reject)
    child.once('exit', (code) => reject(new Error(`database locker exited: ${code}`)))
  })
  return child
}

test('syncs two isolated Electron profiles and recovers after server restart', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tokenlub-electron-'))
  const apps: ElectronApplication[] = []
  let server: Server | undefined

  try {
    const store = createInMemoryPhase1Store()
    const auth = new Phase1AuthService({ store })
    let stored: StoredSyncV2Snapshot | undefined
    const snapshotSync = new SnapshotSyncService({
      store: {
        getDevice: (id) => store.getDevice(id),
        getSyncV2Snapshot: () => stored,
        compareAndSwapSyncV2Snapshot: (input) => {
          if ((stored?.revision ?? 0) !== input.expectedRevision) return undefined
          stored = {
            revision: input.expectedRevision + 1,
            snapshot: input.snapshot,
            updatedAt: input.updatedAt
          }
          return stored
        }
      }
    })
    const user = await auth.registerUser({
      email: 'electron-e2e@example.com',
      password: 'password'
    })
    const deviceA = await auth.registerDevice({ userId: user.id, deviceName: 'A' })
    const deviceB = await auth.registerDevice({ userId: user.id, deviceName: 'B' })
    const handle = createPhase1HttpHandler({ auth, snapshotSync })
    const startServer = (port: number) => {
      server = createPhase1NodeServer({ handle })
      return new Promise<void>((resolve) => server?.listen(port, '127.0.0.1', resolve))
    }
    await startServer(0)
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('expected TCP server address')
    const port = address.port
    const baseUrl = `http://127.0.0.1:${port}`

    for (const name of ['device-a', 'device-b']) {
      apps.push(
        await electron.launch({
          executablePath: electronPath,
          args: ['.', `--user-data-dir=${join(root, name)}`, '--disable-gpu'],
          cwd: process.cwd()
        })
      )
    }

    const [appA, initialAppB] = apps
    let appB = initialAppB
    for (const [app, deviceId] of [
      [appA, deviceA.id],
      [appB, deviceB.id]
    ] as const) {
      const window = await app.firstWindow()
      await expect(window).toHaveTitle('TokenLub')
      await expect(window.locator('body')).not.toBeEmpty()
      await expect(window.evaluate(() => window.api.version)).resolves.toBe(packageVersion)
      await expect(window.evaluate(() => window.api.log.locations())).resolves.toEqual({
        claudeProjects: expect.any(String),
        codexSessions: expect.any(String)
      })
      const locations = await window.evaluate(() => window.api.log.locations())
      expect(isAbsolute(locations.claudeProjects)).toBe(true)
      expect(isAbsolute(locations.codexSessions)).toBe(true)
      await expect(window.evaluate(() => window.api.sync.status())).resolves.toMatchObject({
        configured: false
      })
      await window.evaluate(
        ({ baseUrl: url, deviceId: id }) =>
          window.api.sync.login({
            baseUrl: url,
            email: 'electron-e2e@example.com',
            password: 'password',
            deviceId: id,
            mode: 'merge'
          }),
        { baseUrl, deviceId }
      )
    }

    const windowA = await appA.firstWindow()
    const windowB = await appB.firstWindow()
    await expect(windowA.evaluate(() => window.api.settings.get())).resolves.toEqual({})
    await expect(windowB.evaluate(() => window.api.settings.get())).resolves.toEqual({})

    await windowA.evaluate(() => window.api.settings.set('refresh_interval_min', 17))
    await windowA.evaluate(() => window.api.sync.trigger())
    await windowB.evaluate(() => window.api.sync.trigger())
    await expect(windowB.evaluate(() => window.api.settings.get())).resolves.toMatchObject({
      refresh_interval_min: 17
    })

    await windowA.evaluate(() => window.api.settings.set('refresh_interval_min', 18))
    await new Promise<void>((resolve, reject) =>
      server?.close((error) => (error ? reject(error) : resolve()))
    )
    server = undefined
    await expect(windowA.evaluate(() => window.api.sync.trigger())).rejects.toThrow(/network error/)
    await startServer(port)
    await windowA.evaluate(() => window.api.sync.trigger())
    await windowB.evaluate(() => window.api.sync.trigger())
    await expect(windowB.evaluate(() => window.api.settings.get())).resolves.toMatchObject({
      refresh_interval_min: 18
    })

    await windowA.evaluate(() => window.api.settings.set('refresh_interval_min', 19))
    await windowA.evaluate(() => window.api.sync.trigger())
    const locker = await holdDatabaseLock(join(root, 'device-b', 'tokenlub.db'))
    try {
      await expect(windowB.evaluate(() => window.api.sync.trigger())).rejects.toThrow(/locked/i)
    } finally {
      locker.kill()
    }
    await windowB.evaluate(() => window.api.sync.trigger())
    await expect(windowB.evaluate(() => window.api.settings.get())).resolves.toMatchObject({
      refresh_interval_min: 19
    })

    await appB.close()
    apps[1] = await electron.launch({
      executablePath: electronPath,
      args: ['.', `--user-data-dir=${join(root, 'device-b')}`, '--disable-gpu'],
      cwd: process.cwd()
    })
    appB = apps[1]
    const restartedWindowB = await appB.firstWindow()
    await expect(restartedWindowB.evaluate(() => window.api.sync.status())).resolves.toMatchObject({
      configured: true
    })
    await restartedWindowB.evaluate(() => window.api.sync.trigger())
    await expect(restartedWindowB.evaluate(() => window.api.settings.get())).resolves.toMatchObject(
      {
        refresh_interval_min: 19
      }
    )

    expect(existsSync(join(root, 'device-a', 'tokenlub.db'))).toBe(true)
    expect(existsSync(join(root, 'device-b', 'tokenlub.db'))).toBe(true)
  } finally {
    await Promise.all(apps.map((app) => app.close()))
    if (server) await new Promise<void>((resolve) => server?.close(() => resolve()))
    rmSync(root, { recursive: true, force: true })
  }
})

test('applies 10,000 remote balance snapshots without freezing Electron', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tokenlub-electron-load-'))
  let app: ElectronApplication | undefined
  let server: Server | undefined

  try {
    const store = createInMemoryPhase1Store()
    const auth = new Phase1AuthService({ store })
    const user = await auth.registerUser({
      email: 'electron-load@example.com',
      password: 'password'
    })
    const device = await auth.registerDevice({ userId: user.id, deviceName: 'Load' })
    const stored: StoredSyncV2Snapshot = {
      revision: 1,
      updatedAt: '2026-07-13T00:00:00.000Z',
      snapshot: {
        settings: {},
        pricing: [],
        balances: Array.from({ length: 10_000 }, (_, index) => ({
          id: `550e8400-e29b-41d4-a716-${index.toString().padStart(12, '0')}`,
          providerId: 'openai',
          capturedAt: '2026-07-13T00:00:00.000Z',
          remaining: index
        }))
      }
    }
    const snapshotSync = new SnapshotSyncService({
      store: {
        getDevice: (id) => store.getDevice(id),
        getSyncV2Snapshot: () => stored,
        compareAndSwapSyncV2Snapshot: () => undefined
      }
    })
    const handle = createPhase1HttpHandler({ auth, snapshotSync })
    server = createPhase1NodeServer({ handle })
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('expected TCP server address')

    app = await electron.launch({
      executablePath: electronPath,
      args: ['.', `--user-data-dir=${join(root, 'device')}`, '--disable-gpu'],
      cwd: process.cwd()
    })
    const window = await app.firstWindow()
    await expect(window.locator('body')).toContainText('TokenLub')
    await window.evaluate(
      ({ baseUrl, deviceId }) =>
        window.api.sync.login({
          baseUrl,
          email: 'electron-load@example.com',
          password: 'password',
          deviceId,
          mode: 'restore'
        }),
      { baseUrl: `http://127.0.0.1:${address.port}`, deviceId: device.id }
    )
    const startedAt = performance.now()
    await window.evaluate(() => window.api.sync.trigger())
    expect(performance.now() - startedAt).toBeLessThan(15_000)
    await expect(window.evaluate(() => window.api.balance.latest())).resolves.not.toHaveLength(0)
    await expect(window.locator('body')).toContainText('TokenLub')
  } finally {
    await app?.close()
    if (server) await new Promise<void>((resolve) => server?.close(() => resolve()))
    rmSync(root, { recursive: true, force: true })
  }
})

test('stops safely when a local database fails integrity check', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tokenlub-electron-corrupt-'))
  let app: ElectronApplication | undefined
  let brokenApp: ElectronApplication | undefined
  const databasePath = join(root, 'device', 'tokenlub.db')

  try {
    app = await electron.launch({
      executablePath: electronPath,
      args: ['.', `--user-data-dir=${join(root, 'device')}`, '--disable-gpu'],
      cwd: process.cwd()
    })
    await app.firstWindow()
    await app.close()
    writeFileSync(databasePath, 'corrupt-tokenlub-database')
    rmSync(`${databasePath}-wal`, { force: true })
    rmSync(`${databasePath}-shm`, { force: true })

    brokenApp = await electron.launch({
      executablePath: electronPath,
      args: ['.', `--user-data-dir=${join(root, 'device')}`, '--disable-gpu'],
      cwd: process.cwd()
    })
    await expect(brokenApp.firstWindow({ timeout: 3_000 })).rejects.toThrow()
    expect(existsSync(databasePath)).toBe(true)
  } finally {
    await brokenApp?.close()
    await app?.close()
    rmSync(root, { recursive: true, force: true })
  }
})
