import { initializeAuthentication } from '../../lib/auth/authenticationProvider.js'
import { evaluateAuthorization } from '../../lib/auth/authorizationService.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createAuthenticatedApiHandler } from './_shared/authApi.js'

export function createAuthorizationHealthHandler(options = {}) {
  return createAuthenticatedApiHandler(async ({ requestId, user }) => {
    const authentication = await initializeAuthentication({}, { emitEvent: false, provider: options.authProvider })
    const authorization = evaluateAuthorization({ user, permission: 'dashboard.read', requestId }, { emitEvent: false })
    return {
      event: apiFoundationEvent({ requestId, endpoint: 'authorization-health' }),
      authenticationHealth: authentication.authenticationHealthSummary,
      authorizationStatus: authorization.authorizationStatus,
      role: user.role,
      paperTrading: true,
      liveOrders: false,
      brokerExecution: false,
    }
  }, {
    allowedMethods: ['GET'],
    requiredPermission: 'dashboard.read',
    routeId: 'authorization-health',
    ...options,
  })
}

export const handler = createAuthorizationHealthHandler()
