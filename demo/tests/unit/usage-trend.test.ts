/**
 * usage-trend 单元测试:覆盖 buildModelUsageSeries,
 * 校验按小时(今日)与按日(7天)的用量序列补齐与归类逻辑。
 * (glm-5.2)
 */
import { describe, expect, it } from 'vitest'
import { buildModelUsageSeries } from '../../../code/src/shared/utils/usage-trend'
import type { UsageRecord } from '../../../code/src/shared/types/usage'

function rec(partial: Partial<UsageRecord>): UsageRecord {
  return {
    providerId: 'p1',
    model: 'gpt-5.5',
    source: 'session-log',
    capturedAt: '2026-07-08T01:15:00',
    totalTokens: 100,
    ...partial
  }
}

// buildModelUsageSeries:生成按小时/按日的用量序列并补齐缺失时间桶
describe('buildModelUsageSeries', () => {
  it('fills all 24 hourly buckets for today and places usage in the matching hour', () => {
    const series = buildModelUsageSeries(
      [rec({ totalTokens: 7110500, capturedAt: '2026-07-08T01:15:00' })],
      'today',
      new Date('2026-07-08T12:00:00')
    )

    expect(series.bucketKind).toBe('hour')
    expect(series.points).toHaveLength(24)
    expect(series.points[0]).toMatchObject({ bucket: '2026-07-08 00:00', label: '00:00', m0: 0 })
    expect(series.points[1]).toMatchObject({
      bucket: '2026-07-08 01:00',
      label: '01:00',
      m0: 7110500
    })
    expect(series.points[23]).toMatchObject({ bucket: '2026-07-08 23:00', label: '23:00', m0: 0 })
  })

  it('keeps bounded day ranges dense by backfilling missing dates with zero', () => {
    const series = buildModelUsageSeries(
      [rec({ totalTokens: 500, capturedAt: '2026-07-07T08:00:00' })],
      '7d',
      new Date('2026-07-08T12:00:00')
    )

    expect(series.bucketKind).toBe('day')
    expect(series.points).toHaveLength(7)
    expect(series.points[5]).toMatchObject({ bucket: '2026-07-07', label: '07-07', m0: 500 })
    expect(series.points[6]).toMatchObject({ bucket: '2026-07-08', label: '07-08', m0: 0 })
  })
})
