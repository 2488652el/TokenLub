import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Card } from '../../../code/src/renderer/components/Card'
import { EmptyState } from '../../../code/src/renderer/components/EmptyState'
import {
  AnimatedNumber,
  ProgressBar,
  SortableCardGrid,
  clampProgress
} from '../../../code/src/renderer/components/motion'

describe('renderer motion primitives', () => {
  it('clamps progress values and exposes the final percentage to assistive technology', () => {
    expect(clampProgress(-1)).toBe(0)
    expect(clampProgress(0.42)).toBe(0.42)
    expect(clampProgress(2)).toBe(1)
    expect(clampProgress(Number.NaN)).toBe(0)

    const html = renderToStaticMarkup(
      createElement(ProgressBar, { value: 1.4, label: '缓存命中率' })
    )

    expect(html).toContain('role="progressbar"')
    expect(html).toContain('aria-valuenow="100"')
    expect(html).toContain('aria-label="缓存命中率"')
  })

  it('keeps the final animated number available to screen readers', () => {
    const html = renderToStaticMarkup(
      createElement(AnimatedNumber, {
        value: 169733,
        format: (value: number) => `${Math.round(value)} Tokens`
      })
    )

    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('class="sr-only">169733 Tokens</span>')
  })

  it('maps card motion variants without making every card interactive', () => {
    const staticCard = renderToStaticMarkup(createElement(Card, { motion: 'status' }, '同步状态'))
    const interactiveCard = renderToStaticMarkup(
      createElement(Card, { motion: 'interactive' }, 'API Key')
    )

    expect(staticCard).toContain('data-motion="status"')
    expect(staticCard).toContain('motion-card-status')
    expect(staticCard).not.toContain('motion-card-interactive')
    expect(interactiveCard).toContain('motion-card-interactive')
  })

  it('infers a restrained loading treatment from spinner empty states', () => {
    const html = renderToStaticMarkup(
      createElement(EmptyState, { icon: 'fa-spinner', title: '加载中…' })
    )

    expect(html).toContain('data-state="loading"')
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('motion-empty-loading')
  })

  it('exposes sortable cards as an accessible list with keyboard handles', () => {
    const items = [
      { id: 'alpha', label: 'Alpha' },
      { id: 'beta', label: 'Beta' }
    ]
    const html = renderToStaticMarkup(
      createElement(SortableCardGrid, {
        items,
        getId: (item: (typeof items)[number]) => item.id,
        getLabel: (item: (typeof items)[number]) => item.label,
        onReorder: () => undefined,
        renderItem: (item: (typeof items)[number]) => createElement('article', null, item.label),
        ariaLabel: '测试卡片顺序'
      })
    )

    expect(html).toContain('role="list"')
    expect(html.match(/role="listitem"/g)).toHaveLength(2)
    expect(html).toContain('aria-label="拖动Alpha调整顺序"')
    expect(html).toContain('aria-live="polite"')
  })
})
