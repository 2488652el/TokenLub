import { describe, expect, it } from 'vitest'
import { BindingTicketService } from '../../../../drive/src/server/binding-ticket'

describe('BindingTicketService', () => {
  it('consumes a ticket exactly once', () => {
    const tickets = new BindingTicketService()
    const issued = tickets.create('user-1')

    expect(tickets.consume(issued.ticket)).toBe('user-1')
    expect(() => tickets.consume(issued.ticket)).toThrow('invalid binding ticket')
  })

  it('rejects an expired ticket', () => {
    let now = Date.parse('2026-07-15T00:00:00.000Z')
    const tickets = new BindingTicketService({ ttlMs: 1_000, now: () => now })
    const issued = tickets.create('user-1')
    now += 1_000

    expect(() => tickets.consume(issued.ticket)).toThrow('invalid binding ticket')
  })
})
