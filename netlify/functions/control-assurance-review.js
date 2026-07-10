import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createControlAssuranceRepository, evaluateControlAssurance } from '../../lib/system/controlAssuranceEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'control assurance access denied', { statusCode: 403, publicMessage: 'control assurance access denied' })
}

export function createControlAssuranceReviewHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, query, membership, tenantContext }) => {
    assertOwnerAdmin(membership)
    const repository = options.controlAssuranceRepository ?? createControlAssuranceRepository(options)
    const existing = await repository.list?.({ tenantContext, controlStatus: query.controlStatus, limit: query.limit }) ?? []
    const controlAssurance = evaluateControlAssurance({ tenantContext, policyGovernance: options.policyGovernance, evidenceGovernance: options.evidenceGovernance, remediationEffectiveness: options.remediationEffectiveness, accessReview: options.accessReview, accessCertification: options.accessCertification, policyExceptions: options.policyExceptions, policies: existing }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'control-assurance-review', status: controlAssurance.assuranceStatus }), controlAssurance, automaticEnforcementActions: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'control-assurance-review', ...options })
}

export const handler = createControlAssuranceReviewHandler()
