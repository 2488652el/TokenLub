/**
 * api-key-card 单元测试:覆盖 MiniMax Coding Plan 配额解析逻辑,
 * 验证 model_remains / token-plan remains / legacy 三种数据结构的解析结果。
 * (glm-5.2)
 */
import { describe, expect, it } from 'vitest'
import { extractCodingPlanQuotas } from '../../../code/src/shared/utils/minimax-quota'

// 解析 MiniMax Coding Plan 配额
describe('extractCodingPlanQuotas', () => {
  it('parses the live MiniMax model_remains payload shape', () => {
    const quotas = extractCodingPlanQuotas({
      model_remains: [
        {
          model_name: 'general',
          current_interval_remaining_percent: 99,
          current_weekly_remaining_percent: 54
        },
        {
          model_name: 'video',
          current_interval_remaining_percent: 100,
          current_weekly_remaining_percent: 100
        }
      ]
    })

    expect(quotas.shortWindow).toEqual({
      usedPercent: 1,
      remainingText: '剩余 99%'
    })
    expect(quotas.weeklyWindow).toEqual({
      usedPercent: 46,
      remainingText: '剩余 54%'
    })
  })

  it('parses MiniMax token-plan remains payload with 5h and weekly windows', () => {
    const quotas = extractCodingPlanQuotas({
      data: {
        current_five_hour_remaining_percent: 72,
        current_five_hour_remaining_times: 18,
        current_five_hour_reset_at: '2026-07-09 15:00',
        current_weekly_remaining_percent: 43,
        current_weekly_remaining_times: 9,
        current_weekly_reset_at: '2026-07-13 00:00'
      }
    })

    expect(quotas.shortWindow).toEqual({
      usedPercent: 28,
      remainingText: '剩余 18 次',
      resetText: '重置 2026-07-09 15:00'
    })
    expect(quotas.weeklyWindow).toEqual({
      usedPercent: 57,
      remainingText: '剩余 9 次',
      resetText: '重置 2026-07-13 00:00'
    })
  })

  it('still supports the legacy nested quota shape', () => {
    const quotas = extractCodingPlanQuotas({
      shortWindow: { usedPercent: 12, remainingText: '剩余 88%' },
      weeklyWindow: { usedPercent: 40, remainingText: '剩余 60%' }
    })

    expect(quotas.shortWindow?.usedPercent).toBe(12)
    expect(quotas.weeklyWindow?.remainingText).toBe('剩余 60%')
  })
})
