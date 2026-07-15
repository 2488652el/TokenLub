/**
 * safe-storage 加密包装单元测试:覆盖 encryptSecret / decryptSecret / keyTail,
 * 校验字符串加密往返与密钥尾部脱敏逻辑。
 * (glm-5.2)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const encryptionAvailable = vi.hoisted(() => ({ value: true }))

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => encryptionAvailable.value,
    encryptString: (s: string) => Buffer.from('enc:' + s),
    decryptString: (b: Buffer) => b.toString().replace(/^enc:/, '')
  }
}))

import { encryptSecret, decryptSecret, keyTail } from '../../src/main/crypto/safe-storage'

// safe-storage 包装:验证加密往返与密钥尾部脱敏
describe('safe-storage wrapper', () => {
  beforeEach(() => {
    encryptionAvailable.value = true
  })

  it('round-trips a string', () => {
    expect(decryptSecret(encryptSecret('hello'))).toBe('hello')
  })
  it('keyTail returns last 4 chars', () => {
    expect(keyTail('sk-1234567890abcdef')).toBe('cdef')
  })
  it('keyTail masks short strings', () => {
    expect(keyTail('ab')).toBe('**')
  })

  it('fails closed when the OS keychain is unavailable', () => {
    encryptionAvailable.value = false
    expect(() => encryptSecret('secret')).toThrow('safeStorage is not available')
  })
})
