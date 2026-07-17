import { homedir } from 'node:os'
import path from 'node:path'
import type { CliDisplayPaths, CliPaths, SupportedDesktopPlatform } from '@shared/types/platform'

function getPathImpl(platform: SupportedDesktopPlatform): typeof path.win32 | typeof path.posix {
  return platform === 'win32' ? path.win32 : path.posix
}

export function resolveCliPaths(platform: SupportedDesktopPlatform, home: string): CliPaths {
  const p = getPathImpl(platform)
  const kimiCodeHome = p.join(home, '.kimi-code')
  return {
    claudeProjects: p.join(home, '.claude', 'projects'),
    claudeCredentialFiles: [
      p.join(home, '.claude', '.credentials.json'),
      p.join(home, '.claude', 'credentials.json')
    ],
    codexSessions: p.join(home, '.codex', 'sessions'),
    codexArchivedSessions: p.join(home, '.codex', 'archived_sessions'),
    codexAuthFile: p.join(home, '.codex', 'auth.json'),
    kimiCodeHome,
    kimiCodeSessions: p.join(kimiCodeHome, 'sessions'),
    kimiCodeSessionIndex: p.join(kimiCodeHome, 'session_index.jsonl')
  }
}

export function getCliPaths(): CliPaths {
  if (process.platform !== 'win32' && process.platform !== 'darwin') {
    throw new Error(`Unsupported desktop platform: ${process.platform}`)
  }
  const paths = resolveCliPaths(process.platform, homedir())
  const override = process.env.KIMI_CODE_HOME
  if (!override) return paths
  const p = getPathImpl(process.platform)
  return {
    ...paths,
    kimiCodeHome: override,
    kimiCodeSessions: p.join(override, 'sessions'),
    kimiCodeSessionIndex: p.join(override, 'session_index.jsonl')
  }
}

export function getCliDisplayPaths(): CliDisplayPaths {
  const { claudeProjects, codexSessions, kimiCodeSessions } = getCliPaths()
  return { claudeProjects, codexSessions, kimiCodeSessions }
}
