import { z } from 'zod'

const configSchema = z
  .object({
    DATABASE_URL: z.string().min(1),
    ACCESS_TOKEN_SECRET: z.string().min(32),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    ACCESS_TOKEN_TTL_MS: z.coerce.number().int().positive().default(900_000),
    SYNC_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(120),
    EMAIL_VERIFICATION_REQUIRED: optionalBoolean(false),
    PUBLIC_BASE_URL: optionalHttpsUrl(),
    SMTP_HOST: optionalString(),
    SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(587),
    SMTP_SECURE: optionalBoolean(false),
    SMTP_USER: optionalString(),
    SMTP_PASSWORD: optionalString(),
    SMTP_FROM: optionalString(),
    CONSOLE_ORIGIN: optionalHttpsOrigin(),
    ADMIN_EMAIL: optionalEmail()
  })
  .superRefine((value, context) => {
    const smtpFields = [
      value.PUBLIC_BASE_URL,
      value.SMTP_HOST,
      value.SMTP_USER,
      value.SMTP_PASSWORD,
      value.SMTP_FROM
    ]
    if (
      (value.EMAIL_VERIFICATION_REQUIRED || smtpFields.some(Boolean)) &&
      !smtpFields.every(Boolean)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'SMTP and PUBLIC_BASE_URL configuration is incomplete'
      })
    }
  })

export type Phase1Config = {
  databaseUrl: string
  accessTokenSecret: string
  port: number
  accessTokenTtlMs: number
  syncRateLimitPerMinute: number
  consoleOrigin?: string
  adminEmail?: string
  emailVerificationRequired?: boolean
  smtp?: {
    host: string
    port: number
    secure: boolean
    user: string
    password: string
    from: string
    publicBaseUrl: string
  }
}

export function readPhase1Config(
  env: Record<string, string | undefined> = process.env
): Phase1Config {
  const parsed = configSchema.parse(env)
  return {
    databaseUrl: parsed.DATABASE_URL,
    accessTokenSecret: parsed.ACCESS_TOKEN_SECRET,
    port: parsed.PORT,
    accessTokenTtlMs: parsed.ACCESS_TOKEN_TTL_MS,
    syncRateLimitPerMinute: parsed.SYNC_RATE_LIMIT_PER_MINUTE,
    ...(parsed.CONSOLE_ORIGIN ? { consoleOrigin: parsed.CONSOLE_ORIGIN } : {}),
    ...(parsed.ADMIN_EMAIL ? { adminEmail: parsed.ADMIN_EMAIL } : {}),
    ...(parsed.EMAIL_VERIFICATION_REQUIRED ? { emailVerificationRequired: true } : {}),
    ...(parsed.PUBLIC_BASE_URL &&
    parsed.SMTP_HOST &&
    parsed.SMTP_USER &&
    parsed.SMTP_PASSWORD &&
    parsed.SMTP_FROM
      ? {
          smtp: {
            host: parsed.SMTP_HOST,
            port: parsed.SMTP_PORT,
            secure: parsed.SMTP_SECURE,
            user: parsed.SMTP_USER,
            password: parsed.SMTP_PASSWORD,
            from: parsed.SMTP_FROM,
            publicBaseUrl: parsed.PUBLIC_BASE_URL
          }
        }
      : {})
  }
}

function isHttpsUrl(value: string): boolean {
  return new URL(value).protocol === 'https:'
}

function optionalString() {
  return z.preprocess((value) => (value === '' ? undefined : value), z.string().min(1).optional())
}

function optionalBoolean(defaultValue: boolean) {
  return z.preprocess(
    (value) => (value === undefined || value === '' ? defaultValue : value === 'true'),
    z.boolean()
  )
}

function optionalEmail() {
  return z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().trim().toLowerCase().email().optional()
  )
}

function optionalHttpsUrl() {
  return z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().url().refine(isHttpsUrl, 'URL must use HTTPS').optional()
  )
}

function optionalHttpsOrigin() {
  return z.preprocess(
    (value) => (value === '' ? undefined : value),
    z
      .string()
      .url()
      .refine(isHttpsUrl, 'console origin must use HTTPS')
      .refine((value) => new URL(value).pathname === '/', 'console origin must not include a path')
      .optional()
  )
}
