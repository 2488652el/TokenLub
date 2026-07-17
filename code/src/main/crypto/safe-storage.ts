/**
 * 凭据加密存储模块:基于 Electron safeStorage(底层依赖 Windows DPAPI/
 * macOS Keychain)对敏感数据(如 API Key)进行加解密,并提供脱敏展示工具。
 * (glm-5.2)
 */
import { safeStorage } from 'electron'

/** Encrypt a UTF-8 string using the OS keychain (Windows DPAPI).
 *  使用操作系统密钥链(Windows 上为 DPAPI)加密 UTF-8 字符串,返回加密后的 Buffer。 (glm-5.2)
 */
export function encryptSecret(plain: string): Buffer {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('safeStorage is not available on this OS (no keychain)')
  }
  return safeStorage.encryptString(plain)
}

/** Decrypt a Buffer produced by `encryptSecret`.
 *  解密由 encryptSecret 产生的 Buffer,返回原始 UTF-8 明文字符串。 (glm-5.2)
 */
export function decryptSecret(blob: Buffer): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('safeStorage is not available on this OS (no keychain)')
  }
  return safeStorage.decryptString(blob)
}

/** Returns the last 4 chars of the key, suitable for UI display.
 *  返回密钥的末尾 4 个字符,用于 UI 展示;不足 4 位时返回等长星号。 (glm-5.2)
 */
export function keyTail(plain: string): string {
  if (plain.length <= 4) return '*'.repeat(plain.length)
  return plain.slice(-4)
}
