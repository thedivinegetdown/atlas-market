import { revokeSessionSecurity } from '../../lib/auth/sessionSecurityService.js'
import { createUserSessionRepository } from '../../lib/auth/identityRepository.js'
import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createAuthenticatedApiHandler } from './_shared/authApi.js'

export function createRevokeOtherSessionsHandler(options = {}) {
  return createAuthenticatedApiHandler(async ({ requestId, user, session, repository }) => {
    const result = await revokeSessionSecurity({
      actorUserId: user.id,
      actorRole: user.role,
      targetUserId: user.id,
      sessionId: session.id,
      revokeOthers: true,
    }, {
      repository: options.sessionRepository ?? createUserSessionRepository(options),
      emitEvent: false,
    })
    if (!result.ok) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, result.error?.message ?? 'session revocation denied', {
        statusCode: result.statusCode ?? 403,
        publicMessage: result.error?.message ?? 'session revocation denied',
        metadata: { code: result.error?.code ?? 'session_revocation_denied' },
      })
    }
    if (result.ok) {
      await repository.getStore('enterpriseAuditRecords')?.upsert?.(result.auditRecord.id, result.auditRecord)
    }
    return {
      event: apiFoundationEvent({ requestId, endpoint: 'revoke-other-sessions', status: result.ok ? 'ready' : 'blocked' }),
      result,
      paperTrading: true,
      liveOrders: false,
      brokerExecution: false,
    }
  }, {
    allowedMethods: ['POST'],
    requiredPermission: 'dashboard.read',
    routeId: 'revoke-other-sessions',
    ...options,
  })
}

export const handler = createRevokeOtherSessionsHandler()
