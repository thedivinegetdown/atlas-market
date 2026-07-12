import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createComplianceImplementationProgressRepository, trackComplianceImplementationProgress } from '../../lib/system/complianceImplementationProgressEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'compliance implementation progress access denied', { statusCode: 403, publicMessage: 'compliance implementation progress access denied' })
}

export function createComplianceImplementationProgressHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.complianceImplementationProgressRepository ?? createComplianceImplementationProgressRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const response = await repository.create({ ...body.progress, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-implementation-progress', status: response.ok ? 'tracked' : 'blocked' }), progress: response.progress, automaticImplementation: false, automaticStatusChange: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, progressStatus: query.progressStatus, limit: query.limit }) ?? []
    const complianceImplementationProgress = trackComplianceImplementationProgress({ tenantContext, complianceImplementationProgress: existing, complianceImplementationPlanning: options.complianceImplementationPlanning, complianceGovernanceActionItems: options.complianceGovernanceActionItems }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-implementation-progress', status: complianceImplementationProgress.implementationProgressStatus }), complianceImplementationProgress, automaticImplementation: false, automaticStatusChange: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'compliance-implementation-progress', ...options })
}

export const handler = createComplianceImplementationProgressHandler()
