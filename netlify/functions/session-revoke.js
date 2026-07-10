import { updateUserSession } from '../../lib/auth/identityRepository.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createAuthenticatedApiHandler } from './_shared/authApi.js'

export function createSessionRevokeHandler(options = {}) {
  return createAuthenticatedApiHandler(async ({ requestId, session, repository }) => {
    const result = await updateUserSession({
      action: 'revoke',
      sessionId: session.id,
    }, {
      repository: options.sessionRepository,
      database: options.database,
      emitEvent: false,
    })
    await repository.getStore('enterpriseAuditRecords')?.upsert?.(result.auditRecord.id, result.auditRecord)
    return {
      event: apiFoundationEvent({ requestId, endpoint: 'session-revoke' }),
      revokedSessionId: session.id,
      revocationStatus: result.status,
      paperTrading: true,
      liveOrders: false,
      brokerExecution: false,
    }
  }, {
    allowedMethods: ['POST'],
    requiredPermission: 'dashboard.read',
    routeId: 'session-revoke',
    ...options,
  })
}

export const handler = createSessionRevokeHandler()
