function getPrebuildTarget({ platform, arch, electronVersion }) {
  return [
    '--runtime=electron',
    `--target=${electronVersion}`,
    `--arch=${arch}`,
    `--platform=${platform}`
  ]
}

module.exports = { getPrebuildTarget }
