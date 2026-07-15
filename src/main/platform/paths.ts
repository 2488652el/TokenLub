import { homedir } from 'node:os'
import path from 'node:path'
import type { CliDisplayPaths, CliPaths, SupportedDesktopPlatform } from '@shared/types/platform'

function getPathImpl(platform: SupportedDesktopPlatform): typeof path.win32 | typeof path.posix {
  return platform === 'win32' ? path.win32 : path.posix
}

export function resolveCliPaths(platform: SupportedDesktopPlatform, home: string): CliPaths {
  const p = getPathImpl(platform)
  return {
    claudeProjects: p.join(home, '.claude', 'projects'),
    claudeCredentialFiles: [
      p.join(home, '.claude', '.credentials.json'),
      p.join(home, '.claude', 'credentials.json')
    ],
    codexSessions: p.join(home, '.codex', 'sessions'),
    codexArchivedSessions: p.join(home, '.codex', 'archived_sessions'),
    codexAuthFile: p.join(home, '.codex', 'auth.json')
  }
}

export function getCliPaths(): CliPaths {
  if (process.platform !== 'win32' && process.platform !== 'darwin') {
    throw new Error(`Unsupported desktop platform: ${process.platform}`)
  }
  return resolveCliPaths(process.platform, homedir())
}

export function getCliDisplayPaths(): CliDisplayPaths {
  const { claudeProjects, codexSessions } = getCliPaths()
  return { claudeProjects, codexSessions }
}
