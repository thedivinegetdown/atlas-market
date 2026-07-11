import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createComplianceRegulatoryChangeIntakeRepository, evaluateComplianceRegulatoryChangeIntake } from '../../lib/system/complianceRegulatoryChangeIntakeEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'compliance regulatory change intake access denied', { statusCode: 403, publicMessage: 'compliance regulatory change intake access denied' })
}

export function createComplianceRegulatoryChangeIntakeHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.complianceRegulatoryChangeIntakeRepository ?? createComplianceRegulatoryChangeIntakeRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const response = await repository.create({ ...body.change, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-regulatory-change-intake', status: response.ok ? 'evaluated' : 'blocked' }), change: response.change, automaticRegulatoryClaims: false, automaticPolicyUpdate: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, changeStatus: query.changeStatus, limit: query.limit }) ?? []
    const complianceRegulatoryChangeIntake = evaluateComplianceRegulatoryChangeIntake({ tenantContext, complianceRegulatoryChanges: existing, complianceContinuityReadiness: options.complianceContinuityReadiness, policyControlPlanning: options.policyControlPlanning }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-regulatory-change-intake', status: complianceRegulatoryChangeIntake.regulatoryChangeIntakeStatus }), complianceRegulatoryChangeIntake, automaticRegulatoryClaims: false, automaticPolicyUpdate: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'compliance-regulatory-change-intake', ...options })
}

export const handler = createComplianceRegulatoryChangeIntakeHandler()
