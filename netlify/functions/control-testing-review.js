import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createControlTestingRepository, evaluateControlTesting } from '../../lib/system/controlTestingEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'control testing access denied', { statusCode: 403, publicMessage: 'control testing access denied' })
}

export function createControlTestingReviewHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, query, membership, tenantContext }) => {
    assertOwnerAdmin(membership)
    const repository = options.controlTestingRepository ?? createControlTestingRepository(options)
    const existing = await repository.list?.({ tenantContext, testStatus: query.testStatus, limit: query.limit }) ?? []
    const controlTesting = evaluateControlTesting({ tenantContext, policyGovernance: options.policyGovernance, controlAssurance: options.controlAssurance, controlTests: existing }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'control-testing-review', status: controlTesting.testingStatus }), controlTesting, automaticFindingResolution: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'control-testing-review', ...options })
}

export const handler = createControlTestingReviewHandler()
