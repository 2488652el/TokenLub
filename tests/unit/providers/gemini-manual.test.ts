/**
 * Gemini Manual 供应商单元测试:覆盖无余额 API 与手动连通性测试。
 * (glm-5.2)
 */
import { describe, expect, it } from 'vitest'
import { geminiManualProvider } from '../../../src/main/providers/gemini-manual'

// geminiManualProvider 测试组:覆盖无余额 API 声明与手动探测连通性
describe('geminiManualProvider', () => {
  it('has no balance api', () => {
    const caps = geminiManualProvider.build({ baseUrl: '', apiKey: 't' })
    expect(caps.balance).toBeUndefined()
  })
  it('testConnection returns ok with manual instruction', async () => {
    const caps = geminiManualProvider.build({ baseUrl: '', apiKey: 't' })
    const r = await caps.testConnection()
    expect(r.ok).toBe(true)
    expect(r.message).toContain('手动')
  })
})
