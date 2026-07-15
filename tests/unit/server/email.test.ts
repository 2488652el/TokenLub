import { describe, expect, it, vi } from 'vitest'
import { createVerificationEmailSender } from '../../../src/server/email'

describe('verification email sender', () => {
  it('sends a non-secret-bearing verification link through the injected transport', async () => {
    const sendMail = vi.fn().mockResolvedValue(undefined)
    const send = createVerificationEmailSender({
      from: 'TokenLub <no-reply@example.com>',
      publicBaseUrl: 'https://sync.example.com',
      transport: { sendMail }
    })

    await send({ email: 'user@example.com', token: 'one-time-token' })

    expect(sendMail).toHaveBeenCalledWith({
      from: 'TokenLub <no-reply@example.com>',
      to: 'user@example.com',
      subject: 'Verify your TokenLub email',
      text: expect.stringContaining(
        'https://sync.example.com/v1/auth/verify-email?token=one-time-token'
      )
    })
  })
})
