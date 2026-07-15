import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { resolveCliPaths } from '../../src/main/platform/paths'

describe('resolveCliPaths', () => {
  it('resolves macOS CLI paths with POSIX separators', () => {
    const result = resolveCliPaths('darwin', '/Users/tester')
    expect(result).toEqual({
      claudeProjects: '/Users/tester/.claude/projects',
      claudeCredentialFiles: [
        '/Users/tester/.claude/.credentials.json',
        '/Users/tester/.claude/credentials.json'
      ],
      codexSessions: '/Users/tester/.codex/sessions',
      codexArchivedSessions: '/Users/tester/.codex/archived_sessions',
      codexAuthFile: '/Users/tester/.codex/auth.json'
    })
  })

  it('keeps Windows separators for a spaced home path', () => {
    const result = resolveCliPaths('win32', 'C:\\Users\\Best Z')
    expect(result.claudeProjects).toBe('C:\\Users\\Best Z\\.claude\\projects')
    expect(result.codexSessions).toBe('C:\\Users\\Best Z\\.codex\\sessions')
  })

  it('preserves unicode characters in macOS home paths', () => {
    const result = resolveCliPaths('darwin', '/Users/测 试')
    expect(result.claudeProjects).toBe('/Users/测 试/.claude/projects')
    expect(result.codexAuthFile).toBe('/Users/测 试/.codex/auth.json')
  })

  it('keeps credential file order stable', () => {
    const result = resolveCliPaths('darwin', '/Users/tester')
    expect(result.claudeCredentialFiles[0]).toContain('.credentials.json')
    expect(result.claudeCredentialFiles[1]).toContain('credentials.json')
  })

  it('returns absolute paths for both desktop platforms', () => {
    const win = resolveCliPaths('win32', 'C:\\Users\\Best Z')
    const mac = resolveCliPaths('darwin', '/Users/tester')
    for (const value of win.claudeCredentialFiles) {
      expect(path.win32.isAbsolute(value)).toBe(true)
    }
    for (const value of Object.values(win).filter((v) => typeof v === 'string') as string[]) {
      expect(path.win32.isAbsolute(value)).toBe(true)
    }
    for (const value of Object.values(mac).filter((v) => typeof v === 'string') as string[]) {
      expect(path.posix.isAbsolute(value)).toBe(true)
    }
  })
})
