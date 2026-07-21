/**
 * 模型对比页面:按模型维度聚合请求数、Token 构成、计价覆盖与费用,
 * 使用品牌卡片跨供应商对比模型用量。
 * (glm-5.2)
 */
import { Icon } from '../components/Icon'
import { useEffect, useMemo, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { Card } from '../components/Card'
import { EmptyState } from '../components/EmptyState'
import { ModelUsageCard } from '../components/ModelUsageCard'
import { StatTile } from '../components/StatTile'
import { AnimatedNumber, MotionGroup } from '../components/motion'
import { fmtCount } from '../../shared/utils/money'
import { buildModelCompareSummary } from '../../shared/utils/model-compare'
import type { ModelSpendAggregate } from '../../shared/types/usage'

const MAX_VISIBLE_MODELS = 12

/**
 * 模型对比页面组件。
 * 挂载时拉取按模型聚合的消费数据,渲染对比表格。
 */
export default function ModelCompare() {
  const [models, setModels] = useState<ModelSpendAggregate[] | null>(null)
  const summary = useMemo(() => buildModelCompareSummary(models ?? []), [models])

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
        desc="按模型聚合请求、Token、缓存和费用，跨 Provider 对比使用结构"
        action={
          <span className="inline-flex items-center gap-1.5 rounded-full border border-accent-border bg-accent-dim px-2.5 py-1 text-[11px] font-medium text-accent-text">
            <Icon name="fa-layer-group" className="text-[9px]" />
            模型画像
          </span>
        }
      />

      {models === null ? (
        <Card>
          <EmptyState icon="fa-spinner" title="加载模型数据…" hint="正在聚合本地用量与价格" />
        </Card>
      ) : models.length === 0 ? (
        <Card>
          <EmptyState
            icon="fa-cube"
            title="尚无模型数据"
            hint="先在 API Keys 添加 Key 并刷新即可看到聚合结果"
          />
        </Card>
      ) : (
        <>
          <MotionGroup className="mb-4 grid grid-cols-4 gap-3 max-xl:grid-cols-2">
            <StatTile
              label="活跃模型"
              icon="fa-cubes"
              value={<AnimatedNumber value={summary.modelCount} />}
              sub={`展示费用最高的前 ${Math.min(models.length, MAX_VISIBLE_MODELS)} 个`}
              motionOrder={0}
            />
            <StatTile
              label="模型请求"
              icon="fa-arrow-right-arrow-left"
              value={<AnimatedNumber value={summary.requests} />}
              sub="跨 Provider 聚合"
              accent="blue"
              motionOrder={1}
            />
            <StatTile
              label="总 Token"
              icon="fa-coins"
              value={<AnimatedNumber value={summary.tokens} format={(value) => fmtCount(value)} />}
              sub="Input + Output"
              accent="purple"
              motionOrder={2}
            />
            <StatTile
              label="计价覆盖"
              icon="fa-tag"
              value={
                <AnimatedNumber
                  value={summary.coverage * 100}
                  format={(value) => `${value.toFixed(0)}%`}
                />
              }
              sub={`${summary.pricedRequests}/${summary.requests} 次请求`}
              accent={summary.coverage < 1 ? 'amber' : 'accent'}
              motionOrder={3}
            />
          </MotionGroup>

          <div className="mb-3 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-[13px] font-semibold text-text-primary">模型用量卡片</h2>
              <p className="mt-0.5 text-[11.5px] text-text-muted">
                按费用降序排列，Logo 由 LobeHub Icons 根据模型 ID 自动匹配
              </p>
            </div>
            <span className="font-mono text-[11px] text-text-muted">
              Top {Math.min(models.length, MAX_VISIBLE_MODELS)}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4 max-lg:grid-cols-1">
            {models.slice(0, MAX_VISIBLE_MODELS).map((model, index) => (
              <ModelUsageCard key={model.model} model={model} rank={index + 1} />
            ))}
          </div>

          {models.length > MAX_VISIBLE_MODELS ? (
            <p className="mt-4 text-center text-[11.5px] text-text-muted">
              另有 {models.length - MAX_VISIBLE_MODELS} 个低用量模型未展开
            </p>
          ) : null}
        </>
      )}
    </div>
  )
}
