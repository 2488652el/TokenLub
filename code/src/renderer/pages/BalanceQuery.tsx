/**
 * 余额查询页面:以卡片网格展示每个 Key 的余额、已用、总额、Token、
 * Key 末位与快照时间,支持一键刷新全部。
 * (glm-5.2)
 */
import { useEffect, useMemo, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { Card } from '../components/Card'
import { EmptyState } from '../components/EmptyState'
import { ProviderIcon } from '../components/ProviderIcon'
import { CodexQuotaPanel } from '../components/CodexQuotaPanel'
import { useCodexUsage } from '../hooks/useCodexUsage'
import { fmtCount, fmtMoney } from '../../shared/utils/money'
import type { ApiKeyRecord } from '../../shared/types/api-key'
import type { BalanceSnapshot } from '../../shared/types/provider'

/** 余额卡片数据:Key 记录与其最新余额快照 */
type BalanceCard = {
  key: ApiKeyRecord
  balance: (BalanceSnapshot & { id: number; apiKeyId?: string }) | undefined
}

/**
 * 格式化余额数值:TOKENS 币种用 fmtCount,其余用 fmtMoney,undefined 时返回占位符。
 * @param value 余额值
 * @param currency 币种
 * @param fallback 无值时的占位文本,默认 "-"
 */
function formatBalanceAmount(
  value: number | undefined,
  currency: string | undefined,
  fallback = '—'
): string {
  if (value === undefined) return fallback
  return currency === 'TOKENS' ? fmtCount(value) : fmtMoney(value, currency ?? 'CNY')
}

/**
 * 余额查询页面组件。
 * 拉取密钥与余额快照,按 apiKeyId 取最新一条余额后渲染卡片网格。
 */
export default function BalanceQuery() {
  const [keys, setKeys] = useState<ApiKeyRecord[]>([])
  const [balances, setBalances] = useState<
    Array<BalanceSnapshot & { id: number; apiKeyId?: string }>
  >([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const codex = useCodexUsage()

  /** 加载密钥与余额列表 */
  async function load() {
    setLoading(true)
    try {
      const [k, b] = await Promise.all([
        window.api.keys.list(),
        window.api.balance.latest().catch(() => [])
      ])
      setKeys(k)
      setBalances(b)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  /** 刷新全部 Key 余额并展示成功/失败明细 */
  async function handleRefreshAll() {
    setRefreshing(true)
    try {
      const r = await window.api.usage.refreshAll()
      const failures = Array.isArray(r.failures) ? r.failures : []
      if (r.failed === 0) {
        window.alert(`刷新完成：成功 ${r.refreshed} 个 Key`)
      } else {
        const lines = failures
          .slice(0, 20)
          .map(
            (f) =>
              `    • ${f.alias} (${f.providerId}): ${f.error.length > 100 ? f.error.slice(0, 100) + '…' : f.error}`
          )
        if (failures.length > 20) lines.push(`    …（还有 ${failures.length - 20} 条未显示）`)
        window.alert(
          `刷新完成：\n✓ 成功 ${r.refreshed} 个\n✗ 失败 ${r.failed} 个\n` + lines.join('\n')
        )
      }
      await load()
      await codex.refresh()
    } catch (e) {
      window.alert(`刷新失败：${(e as Error).message}`)
    } finally {
      setRefreshing(false)
    }
  }

  /** 按 apiKeyId 取最新余额快照,组装成卡片数据数组 */
  const cards = useMemo<BalanceCard[]>(() => {
    const latestByKey = new Map<string, BalanceSnapshot & { id: number; apiKeyId?: string }>()
    for (const b of balances) {
      if (!b.apiKeyId) continue
      const prev = latestByKey.get(b.apiKeyId)
      if (!prev || Date.parse(b.capturedAt) > Date.parse(prev.capturedAt)) {
        latestByKey.set(b.apiKeyId, b)
      }
    }
    return keys.map((k) => ({ key: k, balance: latestByKey.get(k.id) }))
  }, [keys, balances])

  const hasKeys = keys.length > 0

  return (
    <div className="page-content animate-in">
      <PageHeader
        title="余额查询"
        desc="按 Key 卡片显示余额，支持立即刷新"
        action={
          <button
            className="btn btn-outline btn-sm"
            onClick={handleRefreshAll}
            disabled={refreshing}
          >
            <i className="fa-solid fa-arrows-rotate" /> 全部刷新
          </button>
        }
      />

      <div className="grid grid-cols-3 gap-4 max-xl:grid-cols-2 max-md:grid-cols-1">
        <Card
          title="ChatGPT"
          subtitle="Codex 订阅额度"
          iconNode={<ProviderIcon providerId="openai-admin" title="ChatGPT" size={18} />}
          action={
            <button
              className="btn btn-ghost btn-xs"
              onClick={() => void codex.refresh()}
              disabled={codex.loading}
              title="刷新 ChatGPT 额度"
            >
              <i className="fa-solid fa-arrows-rotate" />
            </button>
          }
        >
          <CodexQuotaPanel usage={codex.usage} loading={codex.loading} error={codex.error} />
        </Card>
        {loading ? (
          <Card>
            <EmptyState icon="fa-spinner" title="加载中…" hint="读取本地加密数据库" />
          </Card>
        ) : !hasKeys ? (
          <Card>
            <EmptyState icon="fa-wallet" title="尚未添加任何 Key" hint="前往 API Keys 添加" />
          </Card>
        ) : (
          cards.map(({ key, balance }) => (
            <Card
              key={key.id}
              title={key.alias}
              subtitle={key.providerId}
              iconNode={
                <ProviderIcon
                  providerId={key.providerId}
                  title={key.providerId}
                  size={18}
                  className="shrink-0"
                />
              }
            >
              <div className="space-y-2 text-[13px]">
                <div className="flex justify-between">
                  <span className="text-text-muted">剩余</span>
                  <span className="font-mono font-medium">
                    {formatBalanceAmount(balance?.remaining, balance?.currency)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">已用</span>
                  <span className="font-mono">
                    {formatBalanceAmount(balance?.used, balance?.currency)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">总额</span>
                  <span className="font-mono">
                    {formatBalanceAmount(balance?.total, balance?.currency)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">Token</span>
                  <span className="font-mono">
                    {balance?.remaining !== undefined ? fmtCount(balance.remaining) : '—'}
                  </span>
                </div>
                <div className="flex justify-between text-[12px]">
                  <span className="text-text-muted">Key 末位</span>
                  <span className="font-mono text-text-secondary">…{key.keyTail}</span>
                </div>
                <div className="flex justify-between text-[12px]">
                  <span className="text-text-muted">快照时间</span>
                  <span className="text-text-secondary">
                    {balance ? balance.capturedAt.slice(0, 16).replace('T', ' ') : '—'}
                  </span>
                </div>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  )
}
