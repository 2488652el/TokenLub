#!/usr/bin/env node
/**
 * Postinstall 脚本:在 Windows 上确保 Electron 与 better-sqlite3 原生二进制就位,幂等且支持 prebuild 回退 gyp。
 * (glm-5.2)
 */
/**
 * Postinstall helper for native-binary modules on Windows.
 *
 * 1. `better-sqlite3` — prebuilt binary via prebuild-install, fall back to gyp.
 * 2. `electron` — runs the package's own `install.js` to download the Electron
 *    binary zip (skipped when npm runs with `--ignore-scripts`).
 *
 * Idempotent — modules with binaries already in place are skipped.
 */

const { spawnSync } = require('node:child_process')
const { existsSync } = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')

function readElectronVersion() {
  try {
    return require(path.join(root, 'node_modules', 'electron', 'package.json')).version
  } catch {
    return 'unknown'
  }
}

// 1. Ensure Electron binary is downloaded (its postinstall normally does this
//    but `--ignore-scripts` skips it).
const electronDir = path.join(root, 'node_modules', 'electron', 'dist')
const electronExe = path.join(electronDir, 'electron.exe')
if (!existsSync(electronExe)) {
  console.log('[postinstall] Electron binary missing, running electron/install.js...')
  const result = spawnSync(process.execPath, [
    path.join(root, 'node_modules', 'electron', 'install.js')
  ], { stdio: 'inherit' })
  if (result.status !== 0) {
    console.error('[postinstall] electron install failed (status ' + result.status + ')')
    process.exit(result.status ?? 1)
  }
} else {
  console.log('[postinstall] Electron binary present, skipping.')
}

// 2. Ensure better-sqlite3 prebuilt for Electron is in place.
const bs3Dir = path.join(root, 'node_modules', 'better-sqlite3')
if (!existsSync(bs3Dir)) {
  // better-sqlite3 not installed; nothing to do.
  process.exit(0)
}
const bs3Built = path.join(bs3Dir, 'build', 'Release', 'better_sqlite3.node')
if (existsSync(bs3Built)) {
  console.log('[postinstall] better-sqlite3 prebuilt already present, skipping.')
  process.exit(0)
}

const electronVersion = readElectronVersion()
console.log(`[postinstall] fetching better-sqlite3 prebuilt for Electron v${electronVersion}...`)
const prebuildResult = spawnSync(
  path.join(root, 'node_modules', '.bin', 'prebuild-install'),
  [
    '--runtime=electron',
    `--target=${electronVersion}`,
    '--arch=x64',
    '--platform=win32'
  ],
  { cwd: bs3Dir, stdio: 'inherit' }
)

if (prebuildResult.status === 0) {
  console.log('[postinstall] better-sqlite3 prebuilt binary downloaded.')
  process.exit(0)
}

console.warn('[postinstall] prebuild fetch failed — falling back to node-gyp (requires Visual Studio Build Tools).')
const gypResult = spawnSync(process.execPath, [
  path.join(root, 'node_modules', 'node-gyp', 'bin', 'node-gyp.js'),
  'rebuild', '--release'
], { cwd: bs3Dir, stdio: 'inherit' })

process.exit(gypResult.status ?? 1)
