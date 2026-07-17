import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ProviderIcon } from '../../../code/src/renderer/components/ProviderIcon'

describe('ProviderIcon', () => {
  it.each(['kimi-coding', 'moonshot'])('renders the visible Kimi mark for %s', (providerId) => {
    const html = renderToStaticMarkup(
      createElement(ProviderIcon, { providerId, title: providerId, size: 18 })
    )

    expect(html).toContain(`aria-label="${providerId}"`)
    expect(html).toContain('fill="currentColor"')
    expect(html).toContain('color:#1783FF')
    expect(html).not.toContain('>K</span>')
  })
})
