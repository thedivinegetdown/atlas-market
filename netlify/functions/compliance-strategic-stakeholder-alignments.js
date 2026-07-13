import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createComplianceStrategicStakeholderAlignmentRepository, evaluateComplianceStrategicStakeholderAlignment } from '../../lib/system/complianceStrategicStakeholderAlignmentEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'compliance strategic stakeholder access denied', { statusCode: 403, publicMessage: 'compliance strategic stakeholder access denied' })
}

export function createComplianceStrategicStakeholderAlignmentsHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.complianceStrategicStakeholderAlignmentRepository ?? createComplianceStrategicStakeholderAlignmentRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const response = await repository.create({ ...body.alignment, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-strategic-stakeholder-alignments', status: response.ok ? 'evaluated' : 'blocked' }), alignment: response.alignment, automaticStakeholderApproval: false, automaticExecutiveDistribution: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, alignmentStatus: query.alignmentStatus, limit: query.limit }) ?? []
    const complianceStrategicStakeholderAlignment = evaluateComplianceStrategicStakeholderAlignment({ tenantContext, complianceStrategicStakeholderAlignments: existing, complianceStrategicKpis: options.complianceStrategicKpis, complianceStrategicMilestones: options.complianceStrategicMilestones, complianceGovernanceReadout: options.complianceGovernanceReadout }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-strategic-stakeholder-alignments', status: complianceStrategicStakeholderAlignment.stakeholderAlignmentStatus }), complianceStrategicStakeholderAlignment, automaticStakeholderApproval: false, automaticExecutiveDistribution: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'compliance-strategic-stakeholder-alignments', ...options })
}

export const handler = createComplianceStrategicStakeholderAlignmentsHandler()
