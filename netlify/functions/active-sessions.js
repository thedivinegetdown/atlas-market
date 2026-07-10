import { createUserSessionRepository } from '../../lib/auth/identityRepository.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createAuthenticatedApiHandler } from './_shared/authApi.js'

function toPublicSession(session = {}) {
  const { token, tokenHash, ...safeSession } = session
  void token
  void tokenHash
  return safeSession
}

export function createActiveSessionsHandler(options = {}) {
  return createAuthenticatedApiHandler(async ({ requestId, user }) => {
    const sessionRepository = options.sessionRepository ?? createUserSessionRepository(options)
    const sessions = (await sessionRepository.listActiveSessions?.(user.id) ?? []).map(toPublicSession)
    return {
      event: apiFoundationEvent({ requestId, endpoint: 'active-sessions' }),
      sessions,
      rawSessionTokensExposed: false,
      tokenHashesExposed: false,
      paperTrading: true,
      liveOrders: false,
      brokerExecution: false,
    }
  }, {
    allowedMethods: ['GET'],
    requiredPermission: 'dashboard.read',
    routeId: 'active-sessions',
    ...options,
  })
}

export const handler = createActiveSessionsHandler()
