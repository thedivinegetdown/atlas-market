import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { lookupAdministrativeAudit } from '../../lib/system/administrativeAuditService.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

export function createAdministrativeAuditHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, query, membership, tenantContext, repository }) => {
    if (!['owner', 'admin'].includes(membership?.role)) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'administrative audit access denied', {
        statusCode: 403,
        publicMessage: 'administrative audit access denied',
      })
    }
    const audit = await lookupAdministrativeAudit({
      tenantContext,
      query,
    }, {
      repository: options.auditRepository ?? repository,
    })
    return {
      event: apiFoundationEvent({ requestId, endpoint: 'administrative-audit' }),
      audit,
      pagination: audit.pagination,
      safeSorting: audit.filters.sort,
      tokenHashesExposed: false,
      invitationHashesExposed: false,
      sensitiveSessionMaterialExposed: false,
      paperTrading: true,
      liveOrders: false,
      brokerExecution: false,
      billingEnabled: false,
    }
  }, {
    allowedMethods: ['GET'],
    requiredPermission: 'workspace.admin',
    workspaceAction: 'administer',
    routeId: 'administrative-audit',
    ...options,
  })
}

export const handler = createAdministrativeAuditHandler()
