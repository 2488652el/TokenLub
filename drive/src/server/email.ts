import nodemailer from 'nodemailer'

export type VerificationEmail = { email: string; token: string }

type MailMessage = {
  from: string
  to: string
  subject: string
  text: string
}

type MailTransport = { sendMail(message: MailMessage): Promise<unknown> }

type VerificationEmailOptions = {
  from: string
  publicBaseUrl: string
  transport: MailTransport
}

export function createVerificationEmailSender(options: VerificationEmailOptions) {
  return ({ email, token }: VerificationEmail): Promise<unknown> => {
    const url = new URL('/v1/auth/verify-email', `${options.publicBaseUrl}/`)
    url.searchParams.set('token', token)
    return options.transport.sendMail({
      from: options.from,
      to: email,
      subject: 'Verify your MoonMeter email',
      text: `Verify your MoonMeter email: ${url.toString()}`
    })
  }
}

export function createSmtpVerificationEmailSender(options: {
  host: string
  port: number
  secure: boolean
  user: string
  password: string
  from: string
  publicBaseUrl: string
}) {
  const transport = nodemailer.createTransport({
    host: options.host,
    port: options.port,
    secure: options.secure,
    auth: { user: options.user, pass: options.password }
  })
  return createVerificationEmailSender({ ...options, transport })
}
