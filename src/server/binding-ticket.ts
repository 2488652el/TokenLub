import { createHash, randomBytes } from 'node:crypto'

type BindingTicket = {
  userId: string
  expiresAt: number
}

type BindingTicketOptions = {
  ttlMs?: number
  now?: () => number
}

export class BindingTicketService {
  private readonly tickets = new Map<string, BindingTicket>()
  private readonly ttlMs: number
  private readonly now: () => number

  constructor(options: BindingTicketOptions = {}) {
    this.ttlMs = options.ttlMs ?? 2 * 60_000
    this.now = options.now ?? Date.now
  }

  create(userId: string): { ticket: string; expiresAt: string } {
    const ticket = randomBytes(32).toString('base64url')
    const expiresAt = this.now() + this.ttlMs
    this.removeExpired()
    this.tickets.set(hashTicket(ticket), { userId, expiresAt })
    return { ticket, expiresAt: new Date(expiresAt).toISOString() }
  }

  consume(ticket: string): string {
    const key = hashTicket(ticket)
    const stored = this.tickets.get(key)
    this.tickets.delete(key)
    if (!stored || stored.expiresAt <= this.now()) throw new Error('invalid binding ticket')
    return stored.userId
  }

  private removeExpired(): void {
    const now = this.now()
    for (const [key, ticket] of this.tickets) {
      if (ticket.expiresAt <= now) this.tickets.delete(key)
    }
  }
}

function hashTicket(ticket: string): string {
  return createHash('sha256').update(ticket).digest('hex')
}
