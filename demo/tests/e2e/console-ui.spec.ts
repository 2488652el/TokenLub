import { expect, test } from '@playwright/test'
import type { Server } from 'node:http'
import { createPhase1HttpHandler } from '../../../drive/src/server/http'
import { createInMemoryPhase1Store, Phase1AuthService } from '../../../drive/src/server/phase1'
import { createPhase1NodeServer } from '../../../drive/src/server/runtime'
import {
  SnapshotSyncService,
  type StoredSyncV2Snapshot
} from '../../../drive/src/server/snapshot-sync'

type CapturedRequest = {
  path: string
  body: Record<string, unknown>
}

const maliciousDeviceName = '<img src=x onerror="window.__xss=1">'

test.describe.serial('MoonMeter web console', () => {
  let server: Server
  let baseUrl: string
  let loginDeviceId: string
  const capturedRequests: CapturedRequest[] = []

  test.beforeAll(async () => {
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
      email: 'console-login@example.com',
      password: 'password'
    })
    const device = await auth.registerDevice({
      userId: user.id,
      deviceName: maliciousDeviceName,
      platform: 'browser',
      appVersion: 'e2e'
    })
    loginDeviceId = device.id

    const handle = createPhase1HttpHandler({ auth, snapshotSync })
    server = createPhase1NodeServer({
      handle: async (request) => {
        if (
          request.method === 'POST' &&
          ['/v1/auth/login', '/v1/auth/register'].includes(new URL(request.url).pathname)
        ) {
          capturedRequests.push({
            path: new URL(request.url).pathname,
            body: (await request.clone().json()) as Record<string, unknown>
          })
        }
        return handle(request)
      }
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('expected TCP server address')
    baseUrl = `http://127.0.0.1:${address.port}`
  })

  test.afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
  })

  test('switches authentication fields and registers with the expected payload', async ({
    page
  }) => {
    await page.goto(`${baseUrl}/console`)

    await expect(page.locator('#login-tab')).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('#email')).toHaveValue('admin')
    await expect(page.locator('#password')).toHaveValue('password')
    await expect(page.locator('#device-id-field')).toBeVisible()
    await expect(page.locator('#device-name-field')).toBeHidden()

    await page.locator('#register-tab').click()
    await expect(page.locator('#register-tab')).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('#device-id-field')).toBeHidden()
    await expect(page.locator('#device-name-field')).toBeVisible()

    await page.locator('#email').fill('console-register@example.com')
    await page.locator('#password').fill('register-password')
    await page.locator('#device-name').fill('QA Browser')
    await page.locator('#auth-submit').click()

    await expect(page.locator('#app')).toBeVisible()
    expect(capturedRequests.at(-1)).toEqual({
      path: '/v1/auth/register',
      body: {
        email: 'console-register@example.com',
        password: 'register-password',
        deviceName: 'QA Browser'
      }
    })
    await expect(page.locator('#password')).toHaveValue('')

    const stored = await page.evaluate(() => ({
      session: localStorage.getItem('tokenlub.console.session.v1'),
      account: localStorage.getItem('tokenlub.console.account.v1')
    }))
    expect(stored.session).not.toBeNull()
    expect(stored.account).not.toBeNull()
    expect(JSON.stringify(stored)).not.toContain('register-password')

    await page.reload()
    await expect(page.locator('#app')).toBeVisible()
    await expect(page.locator('#email')).toHaveValue('console-register@example.com')
  })

  test('reports login errors through the live status region', async ({ page }) => {
    await page.goto(`${baseUrl}/console`)
    await page.locator('#email').fill('missing@example.com')
    await page.locator('#password').fill('wrong-password')
    await page.locator('#device-id').fill('missing-device')
    await page.locator('#auth-submit').click()

    const status = page.locator('#message')
    await expect(status).toBeVisible()
    await expect(status).toHaveAttribute('role', 'status')
    await expect(status).toHaveAttribute('aria-live', 'polite')
    await expect(status).toHaveAttribute('data-tone', 'error')
    await expect(status).toContainText('authentication required')
  })

  test('logs in with the expected payload and renders hostile device names as text', async ({
    page
  }) => {
    await page.goto(`${baseUrl}/console`)
    await page.locator('#email').fill('console-login@example.com')
    await page.locator('#password').fill('password')
    await page.locator('#device-id').fill(loginDeviceId)
    await page.locator('#auth-submit').click()

    await expect(page.locator('#app')).toBeVisible()
    expect(capturedRequests.at(-1)).toEqual({
      path: '/v1/auth/login',
      body: {
        email: 'console-login@example.com',
        password: 'password',
        deviceId: loginDeviceId
      }
    })
    await expect(page.locator('#devices')).toContainText(maliciousDeviceName)
    await expect(page.locator('#devices img')).toHaveCount(0)
    expect(await page.evaluate(() => (window as Window & { __xss?: number }).__xss)).toBeUndefined()
  })

  test('changes the password, clears the saved session, and keeps the account binding', async ({
    page
  }) => {
    await page.goto(`${baseUrl}/console`)
    await page.locator('#email').fill('console-login@example.com')
    await page.locator('#password').fill('password')
    await page.locator('#device-id').fill(loginDeviceId)
    await page.locator('#auth-submit').click()

    await expect(page.locator('#password-form')).toBeVisible()
    await page.locator('#current-password').fill('password')
    await page.locator('#new-password').fill('new-console-password')
    await page.locator('#password-form button[type="submit"]').click()

    await expect(page.locator('#auth')).toBeVisible()
    await expect(page.locator('#message')).toContainText('密码已修改')
    await expect(page.locator('#password')).toHaveValue('')
    const stored = await page.evaluate(() => ({
      session: localStorage.getItem('tokenlub.console.session.v1'),
      account: localStorage.getItem('tokenlub.console.account.v1')
    }))
    expect(stored.session).toBeNull()
    expect(stored.account).toContain('console-login@example.com')
    expect(stored.account).toContain(loginDeviceId)
    expect(stored.account).not.toContain('new-console-password')
  })

  for (const viewport of [
    { width: 375, height: 812 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 }
  ]) {
    test(`does not overflow horizontally at ${viewport.width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport)
      await page.goto(`${baseUrl}/console`)

      await expect(page.locator('#auth')).toBeVisible()
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      ).toBe(true)
      await page.screenshot({
        path: testInfo.outputPath(`console-auth-${viewport.width}.png`),
        fullPage: true,
        animations: 'disabled'
      })
    })
  }
})
