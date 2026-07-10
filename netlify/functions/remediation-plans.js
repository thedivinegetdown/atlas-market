import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { buildRemediationPlans, createRemediationPlan, createRemediationPlanRepository } from '../../lib/system/remediationPlanningEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'remediation plan access denied', { statusCode: 403, publicMessage: 'remediation plan access denied' })
}

export function createRemediationPlansHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.remediationRepository ?? createRemediationPlanRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const created = await createRemediationPlan({ plan: { ...body.plan, tenantContext, ownerUserId: tenantContext.userId } }, { repository, emitEvent: false })
      return { event: apiFoundationEvent({ requestId, endpoint: 'remediation-plans', status: created.status }), created, recommendationsOnly: true, dashboardExecution: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, approvalStatus: query.approvalStatus, executionStatus: query.executionStatus, limit: query.limit }) ?? []
    const plans = buildRemediationPlans({ tenantContext, administrativeEvidence: options.administrativeEvidence, administrativeCases: options.administrativeCases, operatorAttention: options.operatorAttention, evidence: existing }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'remediation-plans', status: plans.status }), plans, pagination: { limit: Math.min(100, Math.max(1, Number(query.limit ?? 50) || 50)), returned: plans.remediationPlans.length }, recommendationsOnly: true, dashboardExecution: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'remediation-plans', ...options })
}

export const handler = createRemediationPlansHandler()
