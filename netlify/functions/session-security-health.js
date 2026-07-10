import { evaluateSessionSecurity } from '../../lib/auth/sessionSecurityService.js'
import { createUserSessionRepository } from '../../lib/auth/identityRepository.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createAuthenticatedApiHandler } from './_shared/authApi.js'

export function createSessionSecurityHealthHandler(options = {}) {
  return createAuthenticatedApiHandler(async ({ requestId, user }) => {
    const sessionRepository = options.sessionRepository ?? createUserSessionRepository(options)
    const sessions = await sessionRepository.listActiveSessions?.(user.id) ?? []
    const sessionSecurity = evaluateSessionSecurity({
      user,
      sessions,
    }, { emitEvent: false })
    return {
      event: apiFoundationEvent({ requestId, endpoint: 'session-security-health', status: sessionSecurity.securityStatus }),
      sessionSecurity,
      paperTrading: true,
      liveOrders: false,
      brokerExecution: false,
    }
  }, {
    allowedMethods: ['GET'],
    requiredPermission: 'dashboard.read',
    routeId: 'session-security-health',
    ...options,
  })
}

export const handler = createSessionSecurityHealthHandler()
