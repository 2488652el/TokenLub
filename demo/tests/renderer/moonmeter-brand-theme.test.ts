import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import {
  MoonMeterAppIcon,
  MoonMeterMark,
  MoonMeterWordmark
} from '../../../code/src/renderer/components/Brand'
import { Icon } from '../../../code/src/renderer/components/Icon'
import { readStoredCardOrder } from '../../../code/src/renderer/hooks/useCardOrder'
import { resolveThemeMode, themeStorageKey } from '../../../code/src/renderer/theme'

describe('MoonMeter brand and appearance', () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'window')
  })

  it('renders the double-moon mark and accessible wordmark from vector geometry', () => {
    const mark = renderToStaticMarkup(createElement(MoonMeterMark, { title: 'MoonMeter 标志' }))
    const wordmark = renderToStaticMarkup(createElement(MoonMeterWordmark))
    const appIcon = renderToStaticMarkup(createElement(MoonMeterAppIcon))

    expect(mark.match(/<circle/g)).toHaveLength(2)
    expect(mark).toContain('MoonMeter 标志')
    expect(wordmark).toContain('aria-label="MoonMeter"')
    expect(appIcon).toContain('moonmeter-app-icon')
  })

  it('renders Lucide SVGs without depending on icon fonts', () => {
    const html = renderToStaticMarkup(createElement(Icon, { name: 'fa-chart-simple' }))
    expect(html).toContain('<svg')
    expect(html).toContain('lucide')
    expect(html).not.toContain('fa-solid')
  })

  it('resolves system, light, and dark appearance modes deterministically', () => {
    expect(resolveThemeMode('system', false)).toBe('light')
    expect(resolveThemeMode('system', true)).toBe('dark')
    expect(resolveThemeMode('light', true)).toBe('light')
    expect(resolveThemeMode('dark', false)).toBe('dark')
    expect(themeStorageKey).toBe('moonmeter.appearance.v1')
  })

  it('copies legacy card order into the MoonMeter key without deleting the legacy value', () => {
    const storage = new Map<string, string>([
      ['tokenlub.api-key-card-order.v1', JSON.stringify(['beta', 'alpha'])]
    ])
    const localStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value)
    }
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { localStorage }
    })

    expect(readStoredCardOrder('moonmeter.api-key-card-order.v1')).toEqual(['beta', 'alpha'])
    expect(storage.get('moonmeter.api-key-card-order.v1')).toBe(
      storage.get('tokenlub.api-key-card-order.v1')
    )
    expect(storage.has('tokenlub.api-key-card-order.v1')).toBe(true)
  })
})
