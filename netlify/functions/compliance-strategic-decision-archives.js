import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createComplianceStrategicDecisionArchiveRepository, archiveComplianceStrategicDecisions } from '../../lib/system/complianceStrategicDecisionArchiveEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'compliance strategic decision archive access denied', { statusCode: 403, publicMessage: 'compliance strategic decision archive access denied' })
}

export function createComplianceStrategicDecisionArchivesHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.complianceStrategicDecisionArchiveRepository ?? createComplianceStrategicDecisionArchiveRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const response = await repository.create({ ...body.decision, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-strategic-decision-archives', status: response.ok ? 'archived' : 'blocked' }), decision: response.decision, automaticDecisionClaim: false, automaticDecisionApproval: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, archiveStatus: query.archiveStatus, limit: query.limit }) ?? []
    const complianceStrategicDecisionArchive = archiveComplianceStrategicDecisions({ tenantContext, complianceStrategicDecisionArchives: existing, complianceStrategicKnowledgeBase: options.complianceStrategicKnowledgeBase, complianceGovernanceDecisionLog: options.complianceGovernanceDecisionLog, complianceExecutiveStrategyPlan: options.complianceExecutiveStrategyPlan }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-strategic-decision-archives', status: complianceStrategicDecisionArchive.strategicDecisionArchiveStatus }), complianceStrategicDecisionArchive, automaticDecisionClaim: false, automaticDecisionApproval: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'compliance-strategic-decision-archives', ...options })
}

export const handler = createComplianceStrategicDecisionArchivesHandler()
