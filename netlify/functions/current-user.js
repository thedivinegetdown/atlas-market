import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createAuthenticatedApiHandler } from './_shared/authApi.js'

export function createCurrentUserHandler(options = {}) {
  return createAuthenticatedApiHandler(async ({ requestId, user, authorization }) => ({
    event: apiFoundationEvent({ requestId, endpoint: 'current-user' }),
    user: {
      id: user.id,
      provider: user.provider,
      providerSubject: user.providerSubject,
      displayName: user.displayName,
      email: user.email,
      role: user.role,
    },
    authorization: authorization.authorizationStatus,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }), {
    allowedMethods: ['GET'],
    requiredPermission: 'dashboard.read',
    routeId: 'current-user',
    ...options,
  })
}

export const handler = createCurrentUserHandler()
