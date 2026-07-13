import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createInstitutionalChartAdvancedDrawingSyncRepository, prepareInstitutionalChartAdvancedDrawingSync } from '../../lib/system/institutionalChartAdvancedDrawingSyncEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertChartAccess(membership) {
  if (!['owner', 'admin', 'analyst'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Institutional chart advanced drawing access denied', { statusCode: 403, publicMessage: 'Institutional chart advanced drawing access denied' })
}

export function createInstitutionalChartAdvancedDrawingSyncHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertChartAccess(membership)
    const repository = options.institutionalChartAdvancedDrawingSyncRepository ?? createInstitutionalChartAdvancedDrawingSyncRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const persistence = await repository.create({ ...body.state, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'institutional-chart-advanced-drawing-sync', status: persistence.ok ? 'prepared' : 'blocked' }), state: persistence.state, chartingOnly: true, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, advancedDrawingSyncStatus: query.advancedDrawingSyncStatus, limit: query.limit }) ?? []
    const institutionalChartAdvancedDrawingSync = prepareInstitutionalChartAdvancedDrawingSync({ tenantContext, institutionalChartAdvancedDrawingSyncRecords: existing, institutionalChartDrawingInteraction: options.institutionalChartDrawingInteraction, institutionalChartLayout: options.institutionalChartLayout }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'institutional-chart-advanced-drawing-sync', status: institutionalChartAdvancedDrawingSync.institutionalChartAdvancedDrawingSyncStatus }), institutionalChartAdvancedDrawingSync, chartingOnly: true, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'paperTrading.read', workspaceAction: 'read', routeId: 'institutional-chart-advanced-drawing-sync', ...options })
}

export const handler = createInstitutionalChartAdvancedDrawingSyncHandler()
