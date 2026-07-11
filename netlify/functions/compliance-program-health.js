import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createComplianceProgramHealthRepository, evaluateComplianceProgramHealth } from '../../lib/system/complianceProgramHealthEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'compliance program health access denied', { statusCode: 403, publicMessage: 'compliance program health access denied' })
}

export function createComplianceProgramHealthHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.complianceProgramHealthRepository ?? createComplianceProgramHealthRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const response = await repository.create({ ...body.evaluation, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-program-health', status: response.ok ? 'evaluated' : 'blocked' }), evaluation: response.evaluation, automaticComplianceClaims: false, automaticApproval: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, healthStatus: query.healthStatus, limit: query.limit }) ?? []
    const complianceProgramHealth = evaluateComplianceProgramHealth({ tenantContext, complianceProgramHealthEvaluations: existing, complianceRiskCommandCenter: options.complianceRiskCommandCenter, complianceExamReadiness: options.complianceExamReadiness, complianceBoardPacket: options.complianceBoardPacket, complianceMeetingMinutes: options.complianceMeetingMinutes, complianceGovernanceActionItems: options.complianceGovernanceActionItems }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-program-health', status: complianceProgramHealth.programHealthStatus }), complianceProgramHealth, automaticComplianceClaims: false, automaticApproval: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'compliance-program-health', ...options })
}

export const handler = createComplianceProgramHealthHandler()
