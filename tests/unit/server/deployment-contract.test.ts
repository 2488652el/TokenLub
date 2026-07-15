import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const compose = readFileSync(resolve('docker-compose.yml'), 'utf8')
const dockerfile = readFileSync(resolve('Dockerfile'), 'utf8')
const deployGuide = readFileSync(resolve('docs/DEPLOY-UBUNTU.md'), 'utf8')
const privacyAudit = readFileSync(resolve('ops/privacy-audit.sh'), 'utf8')
const restoreRehearsal = readFileSync(resolve('ops/restore-postgres-rehearsal.sh'), 'utf8')
const serverEntry = readFileSync(resolve('src/server/index.ts'), 'utf8')

describe('container deployment contract', () => {
  it('keeps PostgreSQL private and starts app after database health', () => {
    expect(compose).toContain('image: postgres:16-alpine')
    expect(compose).toContain('condition: service_healthy')
    expect(compose).toContain('pg_isready')
    expect(compose).toContain("'127.0.0.1:3000:3000'")
    expect(compose).not.toContain("'5432:5432'")
    expect(compose.match(/restart: unless-stopped/g)).toHaveLength(2)
    expect(restoreRehearsal).toContain('up -d --wait --wait-timeout 60 db')
  })

  it('passes operational configuration and exposes a server healthcheck', () => {
    for (const name of ['SYNC_RATE_LIMIT_PER_MINUTE', 'ADMIN_EMAIL']) {
      expect(compose).toContain(`${name}:`)
    }
    expect(dockerfile).toContain('HEALTHCHECK')
    expect(dockerfile).toContain('/healthz')
    expect(dockerfile).toContain('"server:start"')
    expect(dockerfile).toContain('npm ci --ignore-scripts --include=dev --legacy-peer-deps')
    expect(serverEntry).toContain('async function main(): Promise<void>')
    expect(compose).not.toMatch(/OIDC|SMTP|PUBLIC_BASE_URL|CONSOLE_ORIGIN/)
  })

  it('provides a non-disclosing privacy audit for payloads and logs', () => {
    expect(deployGuide).toContain('sh ops/privacy-audit.sh')
    expect(privacyAudit).toContain('SELECT COUNT(*)')
    expect(privacyAudit).toContain('grep -Eiq')
    expect(privacyAudit).not.toContain('grep -Ei ')
  })
})
