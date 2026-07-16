import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createProductionConfigurationValidationRepository, validateProductionConfiguration } from '../../lib/system/productionConfigurationValidationEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertAccess(membership, method) {
  const role = membership?.role
  if (String(method).toUpperCase() === 'GET' && ['owner', 'admin', 'analyst', 'viewer'].includes(role)) return
  if (['owner', 'admin', 'analyst'].includes(role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Production configuration validation access denied', { statusCode: 403, publicMessage: 'production configuration validation access denied' })
}

export function createProductionConfigurationValidationHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertAccess(membership, event.httpMethod)
    const repository = options.productionConfigurationValidationRepository ?? createProductionConfigurationValidationRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const validated = validateProductionConfiguration({ ...options, ...body, tenantContext, accountId: body.accountId ?? query.accountId ?? options.accountId }, { emitEvent: false })
      const saved = await repository.create?.(validated)
      return { event: apiFoundationEvent({ requestId, endpoint: 'production-configuration-validation', status: validated.configurationValidationStatus }), productionConfigurationValidation: { ...validated, persisted: saved?.ok }, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const snapshots = await repository.list?.({ tenantContext, accountId: query.accountId ?? options.accountId, validationStatus: query.validationStatus, limit: query.limit }) ?? []
    return { event: apiFoundationEvent({ requestId, endpoint: 'production-configuration-validation', status: 'ok' }), productionConfigurationValidation: snapshots, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'production-configuration-validation', ...options })
}

export const handler = createProductionConfigurationValidationHandler()
