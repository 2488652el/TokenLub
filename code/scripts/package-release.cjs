#!/usr/bin/env node

const { spawnSync } = require('node:child_process')
const { readFileSync } = require('node:fs')
const path = require('node:path')

const projectRoot = path.join(__dirname, '..', '..')

function sanitizeSegment(value, label) {
  const withoutControlCharacters = Array.from(String(value ?? ''), (character) =>
    character.charCodeAt(0) < 32 ? '-' : character
  ).join('')
  const sanitized = withoutControlCharacters
    .normalize('NFKC')
    .trim()
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')

  if (!sanitized) {
    throw new Error(`缺少${label}，请使用对应参数或环境变量。`)
  }
  return sanitized.slice(0, 80)
}

function buildReleaseOutputDirectory({ version, change, model }) {
  const safeVersion = sanitizeSegment(version, '版本号')
  const safeChange = sanitizeSegment(change, '修改说明')
  const safeModel = sanitizeSegment(model, '执行模型')
  return path.join('demo', `tokenlub-${safeVersion}-${safeChange}-${safeModel}`)
}

function readArgument(args, name) {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

function parseOptions(args) {
  return {
    platform: readArgument(args, '--platform') ?? 'current',
    arch: readArgument(args, '--arch'),
    change: readArgument(args, '--change') ?? process.env.TOKENLUB_CHANGE,
    model: readArgument(args, '--model') ?? process.env.TOKENLUB_EXECUTION_MODEL,
    dir: args.includes('--dir'),
    dryRun: args.includes('--dry-run')
  }
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: projectRoot, stdio: 'inherit', shell: false })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function buildNodeCliCommand(cliPath, args, nodeExecutable = process.execPath) {
  return { command: nodeExecutable, args: [cliPath, ...args] }
}

function runNodeCli(cliPath, args) {
  const invocation = buildNodeCliCommand(cliPath, args)
  run(invocation.command, invocation.args)
}

function resolveNpmCli() {
  return (
    process.env.npm_execpath ??
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  )
}

function builderArgs(options, outputDirectory, arch) {
  const args = [`--config.directories.output=${outputDirectory}`]
  if (options.dir) args.push('--dir')
  if (options.platform === 'win') args.push('--win')
  if (options.platform === 'mac') args.push('--mac', 'dmg')
  if (arch) args.push(`--${arch}`)
  if (options.platform === 'mac' && process.env.APPLE_TEAM_ID) {
    args.push(`--config.mac.notarize.teamId=${process.env.APPLE_TEAM_ID}`)
  }
  return args
}

function main() {
  const options = parseOptions(process.argv.slice(2))
  const pkg = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8'))
  const outputDirectory = buildReleaseOutputDirectory({
    version: pkg.version,
    change: options.change,
    model: options.model
  })

  console.log(`[package] 输出目录：${outputDirectory}`)
  if (options.dryRun) return

  const npmCli = resolveNpmCli()
  const builderCli = require.resolve('electron-builder/out/cli/cli.js')

  runNodeCli(npmCli, ['run', 'build:clean'])
  const architectures = options.arch === 'all' ? ['x64', 'arm64'] : [options.arch]
  for (const arch of architectures) {
    runNodeCli(builderCli, builderArgs(options, outputDirectory, arch))
  }
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(`[package] ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

module.exports = {
  buildNodeCliCommand,
  buildReleaseOutputDirectory,
  parseOptions,
  sanitizeSegment
}
