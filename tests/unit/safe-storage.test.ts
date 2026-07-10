/**
 * safe-storage 加密包装单元测试:覆盖 encryptSecret / decryptSecret / keyTail,
 * 校验字符串加密往返与密钥尾部脱敏逻辑。
 * (glm-5.2)
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from('enc:' + s),
    decryptString: (b: Buffer) => b.toString().replace(/^enc:/, '')
  }
}))

import { encryptSecret, decryptSecret, keyTail } from '../../src/main/crypto/safe-storage'

// safe-storage 包装:验证加密往返与密钥尾部脱敏
describe('safe-storage wrapper', () => {
  it('round-trips a string', () => {
    expect(decryptSecret(encryptSecret('hello'))).toBe('hello')
  })
  it('keyTail returns last 4 chars', () => {
    expect(keyTail('sk-1234567890abcdef')).toBe('cdef')
  })
  it('keyTail masks short strings', () => {
    expect(keyTail('ab')).toBe('**')
  })
})
