import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createAdministrativePolicyRepository, evaluateAdministrativePolicyGovernance, normalizeAdministrativePolicy } from '../../lib/system/administrativePolicyGovernanceEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'administrative policy access denied', { statusCode: 403, publicMessage: 'administrative policy access denied' })
}

export function createAdministrativePoliciesHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.policyRepository ?? createAdministrativePolicyRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const response = await repository.create({ ...body.policy, tenantContext, policyOwnerUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'administrative-policies', status: response.ok ? 'created' : 'blocked' }), policy: response.policy, automaticEnforcement: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, policyStatus: query.policyStatus, limit: query.limit }) ?? []
    const policyGovernance = evaluateAdministrativePolicyGovernance({ tenantContext, policies: existing.length ? existing : options.policies, evidenceGovernance: options.evidenceGovernance, remediationEffectiveness: options.remediationEffectiveness, administrativeGovernanceCommandCenter: options.administrativeGovernanceCommandCenter }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'administrative-policies', status: policyGovernance.policyGovernanceStatus }), policyGovernance, pagination: { limit: Math.min(100, Math.max(1, Number(query.limit ?? 50) || 50)), returned: policyGovernance.administrativePolicies.length }, automaticEnforcement: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'administrative-policies', ...options })
}

export { normalizeAdministrativePolicy }
export const handler = createAdministrativePoliciesHandler()
