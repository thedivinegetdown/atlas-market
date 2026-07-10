import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { evaluateTenantIsolation } from '../../lib/auth/tenantIsolation.js'
import { evaluateSessionSecurity } from '../../lib/auth/sessionSecurityService.js'
import { evaluateTenantOperationsHealth } from '../../lib/system/tenantOperationsHealthEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'tenant operations access denied', {
      statusCode: 403,
      publicMessage: 'tenant operations access denied',
    })
  }
}

export function createTenantOperationsHealthHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, membership, tenantContext, user }) => {
    assertOwnerAdmin(membership)
    const tenantIsolation = evaluateTenantIsolation(tenantContext, { emitEvent: false })
    const sessionSecurity = evaluateSessionSecurity({ user, sessions: [] }, { emitEvent: false })
    const operations = evaluateTenantOperationsHealth({
      tenantIsolation,
      sessionSecurity,
      collaborationGovernance: options.collaborationGovernance,
      accessReview: options.accessReview,
      eventObservability: options.eventObservability,
      enterpriseAuditTrail: options.enterpriseAuditTrail,
    }, { emitEvent: false })
    return {
      event: apiFoundationEvent({ requestId, endpoint: 'tenant-operations-health', status: operations.operationalStatus }),
      operations,
      tokenHashesExposed: false,
      invitationHashesExposed: false,
      sensitiveSessionMaterialExposed: false,
      paperTrading: true,
      liveOrders: false,
      brokerExecution: false,
    }
  }, {
    allowedMethods: ['GET'],
    requiredPermission: 'workspace.admin',
    workspaceAction: 'administer',
    routeId: 'tenant-operations-health',
    ...options,
  })
}

export const handler = createTenantOperationsHealthHandler()
