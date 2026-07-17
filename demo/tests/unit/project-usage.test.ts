/**
 * 项目用量聚合测试:覆盖项目归并、连续日期桶、Token 汇总与项目配色。
 */
import { describe, expect, it } from 'vitest'
import { buildProjectUsage } from '../../../code/src/shared/utils/project-usage'
import type { UsageRecord } from '../../../code/src/shared/types/usage'

function record(partial: Partial<UsageRecord>): UsageRecord {
  return {
    providerId: 'codex',
    model: 'gpt-5.5',
    source: 'session-log',
    capturedAt: '2026-07-17T12:00:00',
    ...partial
  }
}

describe('buildProjectUsage', () => {
  it('groups sessions by project and builds dense daily buckets', () => {
    const report = buildProjectUsage(
      [
        record({
          agentLabel: 'TokenLub',
          sessionId: 'session-a',
          totalTokens: 120,
          promptTokens: 90,
          completionTokens: 30,
          cost: 1.2,
          capturedAt: '2026-07-16T10:00:00'
        }),
        record({
          agentLabel: 'TokenLub',
          sessionId: 'session-b',
          totalTokens: 80,
          promptTokens: 60,
          completionTokens: 20,
          cost: 0.8,
          capturedAt: '2026-07-16T16:00:00'
        })
      ],
      7,
      new Date('2026-07-17T18:00:00')
    )

    expect(report.dates).toHaveLength(7)
    expect(report.dates.at(-1)).toBe('2026-07-17')
    expect(report.projects).toHaveLength(1)
    expect(report.projects[0]).toMatchObject({
      label: 'TokenLub',
      totalTokens: 200,
      requests: 2,
      cost: 2
    })
    expect(report.projects[0]!.days).toHaveLength(7)
    expect(report.projects[0]!.days.find((day) => day.date === '2026-07-16')).toMatchObject({
      tokens: 200,
      requests: 2,
      cost: 2
    })
    expect(report.projects[0]!.days.find((day) => day.date === '2026-07-17')?.tokens).toBe(0)
  })

  it('assigns different colors and sorts projects by token usage', () => {
    const report = buildProjectUsage(
      [
        record({ agentLabel: 'small', totalTokens: 10 }),
        record({ agentLabel: 'large', totalTokens: 500 })
      ],
      30,
      new Date('2026-07-17T18:00:00')
    )

    expect(report.dates).toHaveLength(30)
    expect(report.projects.map((project) => project.label)).toEqual(['large', 'small'])
    expect(report.projects[0]!.color).not.toBe(report.projects[1]!.color)
  })

  it('falls back to a shortened session id when no project label exists', () => {
    const report = buildProjectUsage(
      [record({ sessionId: '1234567890abcdef', totalTokens: 42 })],
      7,
      new Date('2026-07-17T18:00:00')
    )

    expect(report.projects[0]).toMatchObject({
      key: '1234567890abcdef',
      label: '12345678…',
      totalTokens: 42
    })
  })
})
