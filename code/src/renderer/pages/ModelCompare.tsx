/**
 * 模型对比页面:按模型维度聚合请求数、Input/Output/Cache Read Token 与费用,
 * 跨供应商对比成本与用量,以表格展示 Top 10。
 * (glm-5.2)
 */
import { useEffect, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { Card } from '../components/Card'
import { EmptyState } from '../components/EmptyState'
import { AnimatedNumber } from '../components/motion'
import { fmtCount, fmtMoney } from '../../shared/utils/money'
import type { ModelSpendAggregate } from '../../shared/types/usage'

/**
 * 模型对比页面组件。
 * 挂载时拉取按模型聚合的消费数据,渲染对比表格。
 */
export default function ModelCompare() {
  const [models, setModels] = useState<ModelSpendAggregate[] | null>(null)

  useEffect(() => {
    let alive = true
    window.api.usage
      .getModelSpend()
      .then((rows) => {
        if (alive) setModels(rows)
      })
      .catch(() => {
        if (alive) setModels([])
      })
    return () => {
      alive = false
    }
  }, [])

  return (
    <div className="page-content">
      <PageHeader
        title="模型对比"
        desc="按模型维度聚合，跨 Provider 对比成本与质量"
        action={
          <span className="inline-flex items-center px-2 py-[2px] rounded-full text-[11px] font-medium leading-[1.5] bg-text-primary text-white">
            NEW
          </span>
        }
      />
      <Card>
        {models === null ? (
          <p className="text-text-muted text-[13px] py-6 text-center">加载中…</p>
        ) : models.length === 0 ? (
          <EmptyState
            icon="fa-cube"
            title="尚无模型数据"
            hint="先在 API Keys 添加 Key 并刷新即可看到聚合结果"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="text-text-muted text-left">
                <tr>
                  <th className="py-2 font-medium">#</th>
                  <th className="py-2 font-medium">Model</th>
                  <th className="py-2 font-medium text-right">请求数</th>
                  <th className="py-2 font-medium text-right">Input</th>
                  <th className="py-2 font-medium text-right">Output</th>
                  <th className="py-2 font-medium text-right">Cache Read</th>
                  <th className="py-2 font-medium text-right">费用</th>
                </tr>
              </thead>
              <tbody className="motion-table-rows text-text-primary">
                {models.slice(0, 10).map((m, i) => (
                  <tr key={m.model} className="border-t border-border-light">
                    <td className="py-2 text-text-muted w-8">{i + 1}</td>
                    <td
                      className="py-2 font-mono text-[12px] truncate max-w-[320px]"
                      title={m.model}
                    >
                      {m.model}
                    </td>
                    <td className="py-2 text-right font-mono">
                      {m.requests.toLocaleString('en-US')}
                    </td>
                    <td className="py-2 text-right font-mono">{fmtCount(m.inputTokens)}</td>
                    <td className="py-2 text-right font-mono">{fmtCount(m.outputTokens)}</td>
                    <td className="py-2 text-right font-mono">{fmtCount(m.cacheReadTokens)}</td>
                    <td className="py-2 text-right font-mono">
                      <span key={`${m.model}-${m.total}`} className="motion-data-flash">
                        <AnimatedNumber
                          value={m.total}
                          format={(value) => fmtMoney(value, m.currency)}
                        />
                      </span>
                    </td>
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
