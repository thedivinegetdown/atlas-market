import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createProductionRunValidationRepository, validateProductionRun } from '../../lib/system/releaseApprovalWorkflowEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertAccess(membership, method) {
  const role = membership?.role
  if (String(method).toUpperCase() === 'GET' && ['owner', 'admin', 'analyst', 'viewer'].includes(role)) return
  if (['owner', 'admin'].includes(role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Production run validation access denied', { statusCode: 403, publicMessage: 'production run validation access denied' })
}

export function createProductionRunValidationHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertAccess(membership, event.httpMethod)
    const repository = options.productionRunValidationRepository ?? createProductionRunValidationRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const validation = validateProductionRun({ ...options, ...body, tenantContext, accountId: body.accountId ?? query.accountId ?? options.accountId }, { emitEvent: false })
      const saved = await repository.create?.(validation.productionRunValidation)
      return { event: apiFoundationEvent({ requestId, endpoint: 'production-run-validation', status: validation.validationState }), productionRunValidation: { ...validation, persisted: saved?.ok }, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const validations = await repository.list?.({ tenantContext, accountId: query.accountId ?? options.accountId, validationState: query.validationState, limit: query.limit }) ?? []
    return { event: apiFoundationEvent({ requestId, endpoint: 'production-run-validation', status: 'ok' }), productionRunValidations: validations, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'production-run-validation', ...options })
}

export const handler = createProductionRunValidationHandler()
