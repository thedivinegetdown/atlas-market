import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createAuthenticatedApiHandler } from './_shared/authApi.js'

export function createSessionStatusHandler(options = {}) {
  return createAuthenticatedApiHandler(async ({ requestId, session, user, authorization }) => ({
    event: apiFoundationEvent({ requestId, endpoint: 'session-status' }),
    sessionStatus: session.status,
    expiresAt: session.expiresAt,
    user: { id: user.id, role: user.role, displayName: user.displayName },
    authorization: authorization.authorizationStatus,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }), {
    allowedMethods: ['GET'],
    requiredPermission: 'dashboard.read',
    routeId: 'session-status',
    ...options,
  })
}

export const handler = createSessionStatusHandler()
