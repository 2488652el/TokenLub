/**
 * Agent 明细页面:按 Agent 名称(回退到 sessionId)聚合 session-log 记录,
 * 展示每个 Agent 的请求数、Token 用量与费用,以及汇总统计瓷砖。
 * (glm-5.2)
 */
import { useEffect, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { Card } from '../components/Card'
import { StatTile } from '../components/StatTile'
import { EmptyState } from '../components/EmptyState'
import { fmtCount, fmtMoney } from '../../shared/utils/money'
import type { UsageRecord } from '../../shared/types/usage'

/** Agent 聚合后的单行数据 */
type AgentRow = {
  key: string
  label: string
  fullId: string
  cost: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  requests: number
}

/**
 * 将请求日志按 Agent(优先 agentLabel,其次 sessionId)聚合并按费用降序排列。
 * @param logs 请求日志数组
 * @returns 聚合后的 Agent 行
 */
function aggregateByAgent(logs: UsageRecord[]): AgentRow[] {
  const map = new Map<string, AgentRow>()
  for (const r of logs) {
    // ponytail: prefer the friendly agentLabel; a single label may span
    // multiple sessionIds, so we bucket by `agentLabel ?? sessionId`. Records
    // without either bucket under "(unknown)" so they remain visible.
    const key = r.agentLabel ?? r.sessionId ?? '(unknown)'
    const shortId = r.sessionId ? `${r.sessionId.slice(0, 8)}…` : '(unknown)'
    const label = r.agentLabel ?? shortId
    const existing = map.get(key) ?? {
      key,
      label,
      fullId: r.sessionId ?? key,
      cost: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      requests: 0
    }
    existing.cost += r.cost ?? 0
    existing.inputTokens += r.promptTokens ?? 0
    existing.outputTokens += r.completionTokens ?? 0
    existing.cacheReadTokens += r.cacheReadTokens ?? 0
    existing.requests += 1
    map.set(key, existing)
  }
  return [...map.values()].sort((a, b) => b.cost - a.cost)
}

/**
 * Agent 明细页面组件。
 * 挂载时拉取 session-log 日志,按 Agent 聚合并展示统计瓷砖与明细表格。
 */
export default function AgentDetail() {
  const [logs, setLogs] = useState<UsageRecord[] | null>(null)

  useEffect(() => {
    let alive = true
    window.api.usage
      .getLogs({ source: 'session-log', limit: 200 })
      .then((rows) => {
        if (alive) setLogs(rows)
      })
      .catch(() => {
        if (alive) setLogs([])
      })
    return () => {
      alive = false
    }
  }, [])

  if (logs === null) {
    return (
      <div className="page-content animate-in">
        <PageHeader title="Agent 明细" desc="所有已注册 Agent 的详细用量数据" />
        <Card>
          <p className="text-text-muted text-[13px] py-6 text-center">加载中…</p>
        </Card>
      </div>
    )
  }

  const agents = aggregateByAgent(logs)
  const totalCost = agents.reduce((a, r) => a + r.cost, 0)
  const totalInput = agents.reduce((a, r) => a + r.inputTokens, 0)
  const totalOutput = agents.reduce((a, r) => a + r.outputTokens, 0)
  const totalCacheRead = agents.reduce((a, r) => a + r.cacheReadTokens, 0)
  const totalRequests = agents.reduce((a, r) => a + r.requests, 0)
  const activeAgents = agents.filter((a) => a.requests > 0).length
  const avgTokensPerRequest =
    totalRequests > 0 ? (totalInput + totalOutput + totalCacheRead) / totalRequests : 0

  return (
    <div className="page-content animate-in">
      <PageHeader
        title="Agent 明细"
        desc="所有已注册 Agent 的详细用量数据，优先按 Agent 名称聚合（无名称时回退到 sessionId）"
      />

      <div className="grid grid-cols-4 gap-4 mb-5 max-md:grid-cols-2">
        <StatTile
          label="Agent / Session 数"
          icon="fa-robot"
          value={agents.length}
          sub={`活跃 ${activeAgents} · 共 ${totalRequests.toLocaleString('en-US')} 次请求`}
        />
        <StatTile
          label="总费用"
          icon="fa-coins"
          value={fmtMoney(totalCost)}
          sub={`覆盖 ${logs.length.toLocaleString('en-US')} 条 session-log 记录`}
          accent="amber"
        />
        <StatTile
          label="总 Tokens"
          icon="fa-arrow-right-to-line"
          value={fmtCount(totalInput + totalOutput + totalCacheRead)}
          sub={`Input ${fmtCount(totalInput)} · Output ${fmtCount(totalOutput)}`}
          accent="blue"
        />
        <StatTile
          label="平均每次请求 Tokens"
          icon="fa-scale-balanced"
          value={fmtCount(Math.round(avgTokensPerRequest))}
          sub={`基于 ${totalRequests.toLocaleString('en-US')} 次请求`}
          accent="purple"
        />
      </div>

      <Card title="Agent 用量明细" icon="fa-list-ul">
        {agents.length === 0 ? (
          <EmptyState
            icon="fa-robot"
            title="暂无 Agent"
            hint="尚未导入任何本地 CLI 日志或厂商 Key"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="text-text-muted text-left">
                <tr>
                  <th className="py-2 font-medium">Session / Agent</th>
                  <th className="py-2 font-medium text-right">请求数</th>
                  <th className="py-2 font-medium text-right">Input Tokens</th>
                  <th className="py-2 font-medium text-right">Output Tokens</th>
                  <th className="py-2 font-medium text-right">费用</th>
                </tr>
              </thead>
              <tbody className="text-text-primary">
                {agents.slice(0, 10).map((a) => (
                  <tr key={a.key} className="border-t border-border-light">
                    <td className="py-2 text-[12.5px] truncate max-w-[280px]" title={a.fullId}>
                      {a.label}
                    </td>
                    <td className="py-2 text-right font-mono">
                      {a.requests.toLocaleString('en-US')}
                    </td>
                    <td className="py-2 text-right font-mono">
                      {a.inputTokens.toLocaleString('en-US')}
                    </td>
                    <td className="py-2 text-right font-mono">
                      {a.outputTokens.toLocaleString('en-US')}
                    </td>
                    <td className="py-2 text-right font-mono">{fmtMoney(a.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
