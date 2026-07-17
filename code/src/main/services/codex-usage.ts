/**
 * ChatGPT/Codex 订阅额度查询。
 * 凭据只在主进程读取和使用，renderer 只能收到标准化后的非敏感快照。
 * 这些端点不是公开 API，发生变更时会以安全错误信息降级。
 */
import { existsSync, readFileSync } from 'node:fs'
import { getCliPaths } from '../platform/paths'
import type { CodexUsageSnapshot, CodexUsageWindow } from '@shared/types/codex-usage'

const FIVE_HOURS_SECONDS = 5 * 60 * 60
const ONE_WEEK_SECONDS = 7 * 24 * 60 * 60
const REQUEST_TIMEOUT_MS = 18_000
const USAGE_URLS = [
  'https://chatgpt.com/backend-api/wham/usage',
  'https://chatgpt.com/wham/usage',
  'https://chatgpt.com/api/codex/usage'
] as const

type CodexAuth = {
  accessToken: string
  accountId: string
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

type RawUsageWindow = {
  usedPercent: number
  windowSeconds: number
  resetAtEpoch: number | null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(parsed) ? parsed : null
}

function decodeJwtPayload(token: string | null): Record<string, unknown> | null {
  if (!token) return null
  const payload = token.split('.')[1]
  if (!payload) return null
  try {
    return asRecord(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')))
  } catch {
    return null
  }
}

function accountIdFromClaims(claims: Record<string, unknown> | null): string | null {
  const auth = asRecord(claims?.['https://api.openai.com/auth'])
  return nonEmptyString(auth?.['chatgpt_account_id'])
}

/** 从 Codex auth.json 提取请求所需字段，不返回或记录其他凭据。 */
export function extractCodexUsageAuth(value: unknown): CodexAuth {
  const root = asRecord(value)
  if (!root) throw new Error('Codex auth.json 不是合法对象')

  const tokens = asRecord(root['tokens']) ?? root
  const accessToken = nonEmptyString(tokens['access_token'])
  if (!accessToken) {
    throw new Error('Codex CLI 当前不是 ChatGPT 登录模式，请先执行 codex login')
  }

  const idToken = nonEmptyString(tokens['id_token'])
  const accountId =
    nonEmptyString(tokens['account_id']) ??
    nonEmptyString(root['account_id']) ??
    accountIdFromClaims(decodeJwtPayload(idToken)) ??
    accountIdFromClaims(decodeJwtPayload(accessToken))

  if (!accountId) throw new Error('无法从 Codex auth.json 识别 ChatGPT Account ID')
  return { accessToken, accountId }
}

function readCodexUsageAuth(): CodexAuth {
  const authPath = getCliPaths().codexAuthFile
  if (!existsSync(authPath)) throw new Error('未找到 Codex 登录信息，请先执行 codex login')
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(authPath, 'utf8'))
  } catch {
    throw new Error('Codex auth.json 无法读取或格式无效')
  }
  return extractCodexUsageAuth(parsed)
}

function parseRawWindow(value: unknown): RawUsageWindow | null {
  const row = asRecord(value)
  if (!row) return null
  const usedPercent = finiteNumber(row['used_percent'] ?? row['usedPercent'])
  const windowSeconds = finiteNumber(row['limit_window_seconds'] ?? row['window_seconds'])
  if (usedPercent === null || windowSeconds === null || windowSeconds <= 0) return null

  const resetRaw = finiteNumber(row['reset_at'] ?? row['resetAt'])
  const resetAtEpoch =
    resetRaw === null ? null : resetRaw > 10_000_000_000 ? resetRaw / 1000 : resetRaw
  return { usedPercent, windowSeconds, resetAtEpoch }
}

function collectWindows(payload: Record<string, unknown>): RawUsageWindow[] {
  const windows: RawUsageWindow[] = []
  const collectRateLimit = (value: unknown): void => {
    const rateLimit = asRecord(value)
    if (!rateLimit) return
    for (const key of ['primary_window', 'secondary_window'] as const) {
      const window = parseRawWindow(rateLimit[key])
      if (window) windows.push(window)
    }
  }

  collectRateLimit(payload['rate_limit'])
  const additional = payload['additional_rate_limits']
  if (Array.isArray(additional)) {
    for (const item of additional) collectRateLimit(asRecord(item)?.['rate_limit'])
  }
  return windows
}

function nearestWindow(windows: RawUsageWindow[], targetSeconds: number): CodexUsageWindow | null {
  const source = windows.reduce<RawUsageWindow | null>((nearest, current) => {
    if (!nearest) return current
    return Math.abs(current.windowSeconds - targetSeconds) <
      Math.abs(nearest.windowSeconds - targetSeconds)
      ? current
      : nearest
  }, null)
  if (!source) return null
  // A lone weekly window must not be relabelled as a 5-hour window (or vice
  // versa). Keep the nearest-window compatibility strategy, but only within a
  // 50% duration tolerance around the expected window.
  if (Math.abs(source.windowSeconds - targetSeconds) > targetSeconds * 0.5) return null

  const usedPercent = Math.max(0, Math.min(100, source.usedPercent))
  return {
    usedPercent,
    remainingPercent: 100 - usedPercent,
    windowSeconds: source.windowSeconds,
    resetAt:
      source.resetAtEpoch === null ? null : new Date(source.resetAtEpoch * 1000).toISOString()
  }
}

/** 将 WHAM/Codex 的窗口化响应标准化为 UI 所需的 5 小时和周额度。 */
export function parseCodexUsagePayload(value: unknown, fetchedAt = new Date()): CodexUsageSnapshot {
  const payload = asRecord(value)
  if (!payload) throw new Error('ChatGPT 用量响应格式无效')
  const windows = collectWindows(payload)
  if (windows.length === 0) throw new Error('ChatGPT 用量响应中没有可识别的额度窗口')

  return {
    fetchedAt: fetchedAt.toISOString(),
    planType: nonEmptyString(payload['plan_type']),
    fiveHour: nearestWindow(windows, FIVE_HOURS_SECONDS),
    oneWeek: nearestWindow(windows, ONE_WEEK_SECONDS)
  }
}

async function requestUsage(
  url: string,
  auth: CodexAuth,
  fetchImpl: FetchLike
): Promise<CodexUsageSnapshot> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        'ChatGPT-Account-Id': auth.accountId,
        Accept: 'application/json'
      },
      signal: controller.signal
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return parseCodexUsagePayload(await response.json())
  } finally {
    clearTimeout(timer)
  }
}

/** 按兼容性顺序请求内部用量端点；错误中不包含响应正文或任何凭据。 */
export async function fetchCodexUsage(fetchImpl: FetchLike = fetch): Promise<CodexUsageSnapshot> {
  const auth = readCodexUsageAuth()
  const failures: string[] = []
  for (const url of USAGE_URLS) {
    try {
      return await requestUsage(url, auth, fetchImpl)
    } catch (error) {
      failures.push(`${new URL(url).pathname}: ${(error as Error).message}`)
    }
  }
  throw new Error(`ChatGPT 额度查询失败（${failures.join('；')}）`)
}
