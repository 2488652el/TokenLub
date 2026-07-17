import { describe, expect, it } from 'vitest'
import { parseSyncBindingLink } from '../../../../code/src/main/sync/deep-link'

describe('sync binding deep link', () => {
  const ticket = 'a'.repeat(43)

  it('accepts the dedicated binding route', () => {
    const server = encodeURIComponent('https://sync.example.com')
    expect(parseSyncBindingLink(`tokenlub://sync/bind?server=${server}&ticket=${ticket}`)).toEqual({
      baseUrl: 'https://sync.example.com',
      ticket
    })
  })

  it.each([
    `https://sync/bind?server=https://sync.example.com&ticket=${ticket}`,
    `tokenlub://other/bind?server=https://sync.example.com&ticket=${ticket}`,
    `tokenlub://sync/delete?server=https://sync.example.com&ticket=${ticket}`,
    `tokenlub://sync/bind?server=https://user:pw@sync.example.com&ticket=${ticket}`,
    `tokenlub://sync/bind?server=file:///tmp/server&ticket=${ticket}`,
    'tokenlub://sync/bind?server=https://sync.example.com&ticket=short'
  ])('rejects an unsafe link: %s', (link) => {
    expect(() => parseSyncBindingLink(link)).toThrow('invalid sync binding link')
  })
})
