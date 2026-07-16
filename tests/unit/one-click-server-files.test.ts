import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

it('ships a production sync stack with private PostgreSQL and HTTPS reverse proxy', () => {
  const compose = read('docker-compose.server.yml')
  const sshCompose = read('docker-compose.server-ssh.yml')

  expect(compose).toContain('postgres:16-alpine')
  expect(compose).toContain('caddy:2.8-alpine')
  expect(compose).toContain("- '80:80'")
  expect(compose).toContain("- '443:443'")
  expect(compose).toContain('expose:')
  expect(compose).not.toContain("- '5432:5432'")
  expect(compose).toContain('/healthz')
  expect(sshCompose).toContain("- '127.0.0.1:3000:3000'")
  expect(sshCompose).not.toContain('caddy:2.8-alpine')
})

it('ships idempotent install and safe operational commands', () => {
  const install = read('ops/one-click/install.sh')
  const backup = read('ops/one-click/backup.sh')
  const upgrade = read('ops/one-click/upgrade.sh')
  const healthcheck = read('ops/one-click/healthcheck.sh')
  const uninstall = read('ops/one-click/uninstall.sh')

  expect(install).toContain('set -Eeuo pipefail')
  expect(install).toContain('ACCESS_TOKEN_SECRET')
  expect(install).toContain('--ssh-only')
  expect(install).toContain('--project-name')
  expect(install).toContain('docker compose')
  expect(backup).toContain('pg_dump --format=custom')
  expect(backup).toContain('MIN_FREE_MB')
  expect(upgrade).toContain('已恢复旧版本代码')
  expect(upgrade).toContain('--archive')
  expect(healthcheck).toContain('seq 1 60')
  expect(uninstall).toContain('down --volumes')
})
