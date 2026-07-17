export type SupportedDesktopPlatform = 'win32' | 'darwin'

export interface CliPaths {
  claudeProjects: string
  claudeCredentialFiles: string[]
  codexSessions: string
  codexArchivedSessions: string
  codexAuthFile: string
  kimiCodeHome: string
  kimiCodeSessions: string
  kimiCodeSessionIndex: string
}

export interface CliDisplayPaths {
  claudeProjects: string
  codexSessions: string
  kimiCodeSessions: string
}
