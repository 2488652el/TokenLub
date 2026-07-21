import { app } from 'electron'
import { existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

const LEGACY_PROFILE_NAMES = ['TokenLub', 'TokenScope', 'tokengirl'] as const
const ENCRYPTED_PROFILE_MARKERS = ['moonmeter.db', 'tokenlub.db', 'tokenscope.db'] as const

type PathExists = (path: string) => boolean

function hasEncryptedLegacyProfile(profilePath: string, pathExists: PathExists): boolean {
  if (!pathExists(join(profilePath, 'Local State'))) return false
  return ENCRYPTED_PROFILE_MARKERS.some((fileName) => pathExists(join(profilePath, fileName)))
}

export function resolveCompatibleUserDataPath(
  currentUserData: string,
  appData: string,
  pathExists: PathExists = existsSync
): string {
  if (basename(currentUserData).toLowerCase() !== 'moonmeter') return currentUserData

  for (const profileName of LEGACY_PROFILE_NAMES) {
    const legacyProfile = join(appData, profileName)
    if (hasEncryptedLegacyProfile(legacyProfile, pathExists)) return legacyProfile
  }
  return currentUserData
}

/**
 * Keep upgraded users on the profile that owns their safeStorage encryption context.
 * This must run before requestSingleInstanceLock() and before Electron becomes ready.
 */
export function configureCompatibleUserDataPath(): string {
  const currentUserData = app.getPath('userData')
  if (!app.isPackaged) return currentUserData
  const compatibleUserData = resolveCompatibleUserDataPath(
    currentUserData,
    dirname(currentUserData)
  )
  if (compatibleUserData !== currentUserData) app.setPath('userData', compatibleUserData)
  return compatibleUserData
}
