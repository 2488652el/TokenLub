import type { Phase1AuthService, Phase1Store } from './phase1'

export type AdminClaims = {
  subject: string
  expiresAt: number
}

export type AdminAuthenticator = {
  verify(request: Request): Promise<AdminClaims>
}

export function createOwnerAdminAuthenticator(options: {
  auth: Pick<Phase1AuthService, 'verifyAccessToken'>
  store: Pick<Phase1Store, 'getUserById'>
  ownerEmail: string
}): AdminAuthenticator {
  const ownerEmail = options.ownerEmail.trim().toLowerCase()

  return {
    async verify(request) {
      try {
        const claims = await options.auth.verifyAccessToken(readBearer(request))
        const user = await options.store.getUserById(claims.userId)
        if (user?.email.toLowerCase() !== ownerEmail) throw new Error('not owner')
        return { subject: claims.userId, expiresAt: claims.expiresAt }
      } catch {
        throw new Error('admin authentication failed')
      }
    }
  }
}

function readBearer(request: Request): string {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') ?? '')
  if (!match?.[1]) throw new Error('missing admin bearer')
  return match[1]
}
