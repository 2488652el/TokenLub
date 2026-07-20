import { describe, expect, it } from 'vitest'
import {
  mergeVisibleCardOrder,
  moveCard,
  normalizeCardOrder
} from '../../../code/src/shared/utils/card-order'

describe('card ordering', () => {
  it('keeps known preferences, removes stale ids, and appends new cards', () => {
    expect(normalizeCardOrder(['a', 'b', 'c'], ['c', 'missing', 'c', 'a'])).toEqual(['c', 'a', 'b'])
  })

  it('moves a card to the hovered slot without mutating the input', () => {
    const order = ['a', 'b', 'c', 'd']
    expect(moveCard(order, 'a', 'c')).toEqual(['b', 'c', 'a', 'd'])
    expect(moveCard(order, 'd', 'b')).toEqual(['a', 'd', 'b', 'c'])
    expect(order).toEqual(['a', 'b', 'c', 'd'])
  })

  it('reorders filtered cards while hidden cards keep their slots', () => {
    expect(mergeVisibleCardOrder(['a', 'b', 'c', 'd', 'e'], ['e', 'c', 'a'])).toEqual([
      'e',
      'b',
      'c',
      'd',
      'a'
    ])
  })
})
