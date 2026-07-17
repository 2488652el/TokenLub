import { expect, test } from '@playwright/test'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Server } from 'node:http'
import { createPhase1HttpHandler } from '../../../drive/src/server/http'
import { createInMemoryPhase1Store, Phase1AuthService } from '../../../drive/src/server/phase1'
import { createPhase1NodeServer } from '../../../drive/src/server/runtime'
import {
  SnapshotSyncService,
  type StoredSyncV2Snapshot
} from '../../../drive/src/server/snapshot-sync'

const electronPath = createRequire(__filename)('electron') as string

async function closeServer(server: Server | undefined): Promise<void> {
  if (!server) return
  await new Promise<void>((resolve) => server.close(() => resolve()))
}

async function resizeElectronWindow(
  app: ElectronApplication,
  width: number,
  height: number
): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, size) => {
      const window = BrowserWindow.getAllWindows()[0]
      if (!window) throw new Error('expected Electron window')
      window.setSize(size.width, size.height)
    },
    { width, height }
  )
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const root = document.documentElement
        const content = document.querySelector<HTMLElement>('.page-content')
        return {
          root: root.scrollWidth - root.clientWidth,
          content: content ? content.scrollWidth - content.clientWidth : -1
        }
      })
    )
    .toEqual({ root: 0, content: 0 })
}

test('drives sync login, restore cancellation, manual sync, and responsive layout through UI', async ({
  browserName
}, testInfo) => {
  expect(browserName).toBe('chromium')
  const root = mkdtempSync(join(tmpdir(), 'tokenlub-sync-login-ui-'))
  let app: ElectronApplication | undefined
  let server: Server | undefined

  try {
    const store = createInMemoryPhase1Store()
    const auth = new Phase1AuthService({ store })
    const user = await auth.registerUser({
      email: 'sync-ui@example.com',
      password: 'correct horse battery'
    })
    const device = await auth.registerDevice({ userId: user.id, deviceName: 'QA Desktop' })
    let stored: StoredSyncV2Snapshot | undefined
    let exchangeRequests = 0
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
    const handle = createPhase1HttpHandler({
      auth,
      snapshotSync,
      log: (entry) => {
        if (entry.method === 'POST' && entry.path === '/v1/sync/exchange') exchangeRequests++
      }
    })
    server = createPhase1NodeServer({ handle })
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('expected TCP server address')
    const baseUrl = `http://127.0.0.1:${address.port}`

    app = await electron.launch({
      executablePath: electronPath,
      args: ['.', `--user-data-dir=${join(root, 'profile')}`, '--disable-gpu'],
      cwd: process.cwd()
    })
    const window = await app.firstWindow()
    await expect(window).toHaveTitle('TokenLub')
    await window.getByRole('link', { name: '设置' }).click()
    await expect(window.getByRole('heading', { name: 'TokenLub 云端同步' })).toBeVisible()
    await expect(window.getByText('备份目录', { exact: true })).toBeVisible()
    await expect(window.getByRole('button', { name: '修改' })).toBeVisible()
    await expect(window.getByRole('button', { name: '立即同步' })).toHaveCount(0)
    await expect(window.evaluate(() => window.api.sync.status())).resolves.toMatchObject({
      configured: false
    })

    await window.getByLabel('服务地址').fill(baseUrl)
    await window.getByLabel('邮箱').fill('sync-ui@example.com')
    await window.getByLabel('密码').fill('correct horse battery')
    await window.getByLabel('设备 ID').fill(device.id)
    await window.getByLabel('初次同步模式').selectOption('restore')

    let restoreDialogSeen = false
    window.once('dialog', async (dialog) => {
      restoreDialogSeen = true
      expect(dialog.message()).toContain('恢复云端数据会覆盖本机已有的同步投影')
      await dialog.dismiss()
    })
    await window.getByRole('button', { name: '连接并开始同步' }).click()
    await expect.poll(() => restoreDialogSeen).toBe(true)
    await expect(window.evaluate(() => window.api.sync.status())).resolves.toMatchObject({
      configured: false
    })
    expect(exchangeRequests).toBe(0)
    await expect(window.getByRole('button', { name: '立即同步' })).toHaveCount(0)

    await window.getByLabel('初次同步模式').selectOption('merge')
    await window.getByRole('button', { name: '连接并开始同步' }).click()
    await expect(window.getByText('已连接', { exact: true })).toBeVisible()
    await expect(window.getByText('合并', { exact: true })).toBeVisible()
    await expect(window.getByText('QA Desktop', { exact: true })).toBeVisible()
    await expect(window.evaluate(() => window.api.sync.status())).resolves.toMatchObject({
      configured: true,
      state: 'idle',
      mode: 'merge'
    })

    await window.getByRole('button', { name: '重新连接' }).click()
    await expect(window.getByLabel('密码')).toHaveValue('')
    await expect(window.locator('body')).not.toContainText('correct horse battery')
    await window.getByRole('button', { name: '取消' }).click()

    const exchangesBeforeManualSync = exchangeRequests
    await window.getByRole('button', { name: '立即同步' }).click()
    await expect.poll(() => exchangeRequests).toBeGreaterThan(exchangesBeforeManualSync)
    await expect(window.getByRole('button', { name: '立即同步' })).toBeEnabled()

    for (const size of [
      { width: 1280, height: 800, name: '1280x800' },
      { width: 1024, height: 640, name: '1024x640' }
    ]) {
      await resizeElectronWindow(app, size.width, size.height)
      await expectNoHorizontalOverflow(window)
      await window.screenshot({
        path: testInfo.outputPath(`sync-settings-${size.name}.png`),
        animations: 'disabled'
      })
    }
  } finally {
    await app?.close()
    await closeServer(server)
    rmSync(root, { recursive: true, force: true })
  }
})
