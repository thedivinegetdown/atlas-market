import { issueCsrfToken } from '../../lib/security/csrfProtection.js'
import { createAuthenticatedApiHandler } from './_shared/authApi.js'

export function createCsrfTokenHandler(options = {}) {
  return createAuthenticatedApiHandler(({ token, session, user }) => ({
    ...issueCsrfToken({ bearerToken: token, session, user, now: options.now?.() ?? new Date(), ttlMs: options.ttlMs }),
    authenticationRequired: true,
    grantsAuthentication: false,
  }), { allowedMethods: ['GET'], requiredPermission: 'dashboard.read', routeId: 'csrf-token', ...options })
}

export const handler = createCsrfTokenHandler()
