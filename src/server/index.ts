import { readPhase1Config } from './config'
import { startPhase1Server } from './runtime'
import { createSmtpVerificationEmailSender } from './email'

async function main(): Promise<void> {
  const config = readPhase1Config()
  const { smtp, ...runtimeConfig } = config
  const runtime = await startPhase1Server({
    ...runtimeConfig,
    ...(config.consoleOrigin ? { corsOrigin: config.consoleOrigin } : {}),
    ...(smtp
      ? {
          emailVerificationRequired: true,
          sendVerificationEmail: createSmtpVerificationEmailSender(smtp)
        }
      : {})
  })
  const address = runtime.server.address()
  const port = address && typeof address !== 'string' ? address.port : config.port

  console.log(`TokenLub sync server listening on ${port}`)

  async function shutdown(): Promise<void> {
    await new Promise<void>((resolve, reject) =>
      runtime.server.close((error) => (error ? reject(error) : resolve()))
    )
    await runtime.pool.end()
  }

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void shutdown().catch(() => {
        process.exitCode = 1
      })
    })
  }
}

void main().catch(() => {
  console.error('TokenLub sync server failed to start')
  process.exitCode = 1
})
