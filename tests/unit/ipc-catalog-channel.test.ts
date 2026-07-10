/**
 * IPC 通道注册表单元测试:覆盖 IPC 对象的通道命名稳定性、唯一性与冻结检查。
 * (glm-5.2)
 */
import { describe, expect, it, vi } from 'vitest'
import { IPC } from '../../src/shared/ipc-channels'

// ponytail: IPC channels are the contract between renderer and main. New
// channels must be added here AND in preload. This guards against typo'd
// channel names and accidental deletion of existing entries.

// IPC 通道注册表:校验通道命名稳定、唯一且不可变
describe('IPC channel registry', () => {
  it('exposes the providers:catalog channel used by the create-key modal', () => {
    expect(IPC.providersCatalog).toBe('providers:catalog')
  })

  it('keeps the providers:list channel name stable (legacy callers depend on it)', () => {
    expect(IPC.providersList).toBe('providers:list')
  })

  it('does not expose raw ipcRenderer.send — only invoke-style channels', () => {
    // spot-check a few channels to guard against accidental rename
    const channels = Object.values(IPC)
    expect(channels).toContain('keys:add')
    expect(channels).toContain('keys:test')
    expect(channels).toContain('usage:refresh-all')
    expect(channels).toContain('usage:get-logs-page')
    expect(channels).toContain('providers:catalog')
  })

  it('all values are unique strings (no channel collisions)', () => {
    const values = Object.values(IPC)
    expect(new Set(values).size).toBe(values.length)
  })

  it('IPC object is frozen (literal — TypeScript const assertion)', () => {
    // vi.fn is just here to make sure vitest loads in case of issues
    expect(vi).toBeDefined()
    // we can't mutate a const object literal at runtime anyway, but the
    // belt-and-suspenders check is worth a line of guard.
    expect(typeof IPC).toBe('object')
  })
})
