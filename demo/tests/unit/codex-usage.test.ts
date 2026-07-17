import { describe, expect, it } from 'vitest'
import {
  extractCodexUsageAuth,
  parseCodexUsagePayload
} from '../../../code/src/main/services/codex-usage'

function jwt(payload: object): string {
  return `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`
}

describe('Codex ChatGPT usage', () => {
  it('extracts access token and account id without exposing unrelated auth fields', () => {
    expect(
      extractCodexUsageAuth({
        auth_mode: 'chatgpt',
        tokens: { access_token: 'access-token', account_id: 'account-123', refresh_token: 'secret' }
      })
    ).toEqual({ accessToken: 'access-token', accountId: 'account-123' })
  })

  it('falls back to the id token ChatGPT account claim', () => {
    const idToken = jwt({
      'https://api.openai.com/auth': { chatgpt_account_id: 'account-from-jwt' }
    })
    expect(
      extractCodexUsageAuth({ tokens: { access_token: 'access-token', id_token: idToken } })
    ).toEqual({ accessToken: 'access-token', accountId: 'account-from-jwt' })
  })

  it('selects the nearest 5-hour and weekly windows and converts used to remaining', () => {
    const snapshot = parseCodexUsagePayload(
      {
        plan_type: 'plus',
        rate_limit: {
          primary_window: {
            used_percent: 12.5,
            limit_window_seconds: 18_000,
            reset_at: 1_800_000_000
          },
          secondary_window: {
            used_percent: 45,
            limit_window_seconds: 604_800,
            reset_at: 1_800_100_000
          }
        }
      },
      new Date('2026-07-16T00:00:00Z')
    )

    expect(snapshot.planType).toBe('plus')
    expect(snapshot.fiveHour).toMatchObject({ remainingPercent: 87.5, windowSeconds: 18_000 })
    expect(snapshot.oneWeek).toMatchObject({ remainingPercent: 55, windowSeconds: 604_800 })
    expect(snapshot.fetchedAt).toBe('2026-07-16T00:00:00.000Z')
  })

  it('collects additional rate limits and accepts millisecond reset timestamps', () => {
    const snapshot = parseCodexUsagePayload({
      additional_rate_limits: [
        {
          rate_limit: {
            primary_window: {
              used_percent: 20,
              limit_window_seconds: 18_200,
              reset_at: 1_800_000_000_000
            },
            secondary_window: {
              used_percent: 30,
              limit_window_seconds: 604_700,
              reset_at: 1_800_100_000_000
            }
          }
        }
      ]
    })

    expect(snapshot.fiveHour?.resetAt).toBe(new Date(1_800_000_000_000).toISOString())
    expect(snapshot.oneWeek?.remainingPercent).toBe(70)
  })

  it('does not duplicate a lone weekly window into the 5-hour slot', () => {
    const snapshot = parseCodexUsagePayload({
      plan_type: 'plus',
      rate_limit: {
        primary_window: {
          used_percent: 37,
          limit_window_seconds: 604_800,
          reset_at: 1_800_000_000
        }
      }
    })

    expect(snapshot.fiveHour).toBeNull()
    expect(snapshot.oneWeek?.remainingPercent).toBe(63)
  })
})
