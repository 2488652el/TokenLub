/**
 * CLI 密钥探测模块:从本机已安装的 Claude Code 与 Codex CLI 中检测
 * 现有的 Anthropic / OpenAI API 密钥(环境变量优先,其次凭据文件),
 * 供"一键导入"功能使用。返回结果会对密钥做脱敏处理,明文仅在主进程内短暂使用。
 * (glm-5.2)
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Claude Code 密钥检测结果。
 * 注意:fullKey 仅用于导入且绝不可持久化/记录日志/跨进程透传给渲染层。
 */
export interface ClaudeKeyDetection {
  found: boolean
  /** Masked key, e.g. "sk-ant-...wXYZ" - never the full key.
   *  脱敏密钥,如 "sk-ant-...wXYZ",绝不返回完整密钥。 (glm-5.2) */
  maskedKey?: string
  /** File path the key was read from, or 'env:ANTHROPIC_API_KEY'.
   *  密钥来源路径,或 'env:ANTHROPIC_API_KEY'。 (glm-5.2) */
  path?: string
  /**
   * The full key - ONLY used transiently for import; never persisted to logs.
   * SECURITY CONTRACT: The main process MUST strip `fullKey` before sending any
   * detection result to the renderer. The renderer only ever sees `maskedKey`
   * and `path`. Never log `fullKey`, never write it to disk, never include it in
   * IPC payloads that cross the trust boundary into the renderer process.
   *
   * 安全约定:完整密钥仅用于导入,主进程在将检测结果发往渲染层前必须移除 fullKey;
   * 渲染层只能看到 maskedKey 与 path,严禁记录日志、写入磁盘或跨信任边界透传。 (glm-5.2)
   */
  fullKey?: string
}

/**
 * Codex CLI 密钥检测结果。与 ClaudeKeyDetection 安全约定一致。
 */
export interface CodexKeyDetection {
  found: boolean
  maskedKey?: string
  path?: string
  /** See ClaudeKeyDetection.fullKey - same security contract applies.
   *  见 ClaudeKeyDetection.fullKey,安全约定相同。 (glm-5.2) */
  fullKey?: string
}

/** Mask a key for safe display: keep first 8 and last 4 chars, mask the middle.
 *  密钥脱敏:保留前 8 位与末尾 4 位,中间用省略号;不足 12 位时返回 "****"。 (glm-5.2)
 */
export function maskKey(key: string): string {
  if (key.length <= 12) return '****'
  return `${key.slice(0, 8)}...${key.slice(-4)}`
}

/**
 * Detect an existing Anthropic API key from Claude Code's local install.
 * Checks env var first (fastest, no file read), then credential files.
 *
 * 从本机 Claude Code 安装中检测现有 Anthropic API 密钥;先查环境变量(最快、无需读文件),再查凭据文件。 (glm-5.2)
 */
export function detectClaudeKey(): ClaudeKeyDetection {
  // 1. Environment variable
  const envKey = process.env['ANTHROPIC_API_KEY']
  if (envKey && envKey.trim()) {
    return {
      found: true,
      maskedKey: maskKey(envKey.trim()),
      path: 'env:ANTHROPIC_API_KEY',
      fullKey: envKey.trim()
    }
  }

  // 2. Credential files (newest first)
  const home = homedir()
  const candidates = [
    join(home, '.claude', '.credentials.json'),
    join(home, '.claude', 'credentials.json')
  ]
  for (const credPath of candidates) {
    if (!existsSync(credPath)) continue
    try {
      const raw = readFileSync(credPath, { encoding: 'utf8' })
      const parsed = JSON.parse(raw) as {
        apiKeys?: Array<{ key?: string; label?: string }>
        claudeAiOauth?: { accessToken?: string }
      }
      // Look for an API key in apiKeys array
      const keyEntry = parsed.apiKeys?.find(
        (k) => typeof k.key === 'string' && k.key.startsWith('sk-ant-')
      )
      if (keyEntry?.key) {
        return {
          found: true,
          maskedKey: maskKey(keyEntry.key),
          path: credPath,
          fullKey: keyEntry.key
        }
      }
    } catch {
      // Malformed JSON or permission error — try next candidate
    }
  }
  return { found: false }
}

/**
 * Detect an existing OpenAI API key from Codex CLI's local install.
 * Checks env var first, then ~/.codex/auth.json.
 *
 * 从本机 Codex CLI 安装中检测现有 OpenAI API 密钥;先查环境变量,再查 ~/.codex/auth.json。 (glm-5.2)
 */
export function detectCodexKey(): CodexKeyDetection {
  // 1. Environment variable
  const envKey = process.env['OPENAI_API_KEY']
  if (envKey && envKey.trim()) {
    return {
      found: true,
      maskedKey: maskKey(envKey.trim()),
      path: 'env:OPENAI_API_KEY',
      fullKey: envKey.trim()
    }
  }

  // 2. auth.json
  const home = homedir()
  const authPath = join(home, '.codex', 'auth.json')
  if (existsSync(authPath)) {
    try {
      const raw = readFileSync(authPath, { encoding: 'utf8' })
      const parsed = JSON.parse(raw) as {
        OPENAI_API_KEY?: string
        tokens?: { access_token?: string }
      }
      const key = parsed.OPENAI_API_KEY
      if (typeof key === 'string' && key.trim() && key.startsWith('sk-')) {
        return {
          found: true,
          maskedKey: maskKey(key.trim()),
          path: authPath,
          fullKey: key.trim()
        }
      }
    } catch {
      // malformed — fall through
    }
  }
  return { found: false }
}

/**
 * Detect both Claude and Codex keys in one call.
 * Used by the "import existing key" UI flow.
 *
 * 一次性检测 Claude 与 Codex 密钥,供"导入现有密钥"UI 流程使用。 (glm-5.2)
 */
export function detectAllCLIKeys(): {
  claude: ClaudeKeyDetection
  codex: CodexKeyDetection
} {
  return { claude: detectClaudeKey(), codex: detectCodexKey() }
}
