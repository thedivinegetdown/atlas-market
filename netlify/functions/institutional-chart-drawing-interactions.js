import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createInstitutionalChartDrawingInteractionRepository, prepareInstitutionalChartDrawingInteraction } from '../../lib/system/institutionalChartDrawingInteractionEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertChartAccess(membership) {
  if (!['owner', 'admin', 'analyst'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Institutional chart drawing access denied', { statusCode: 403, publicMessage: 'Institutional chart drawing access denied' })
}

export function createInstitutionalChartDrawingInteractionsHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertChartAccess(membership)
    const repository = options.institutionalChartDrawingInteractionRepository ?? createInstitutionalChartDrawingInteractionRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const persistence = await repository.create({ ...body.state, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'institutional-chart-drawing-interactions', status: persistence.ok ? 'prepared' : 'blocked' }), state: persistence.state, chartingOnly: true, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, drawingInteractionStatus: query.drawingInteractionStatus, limit: query.limit }) ?? []
    const institutionalChartDrawingInteraction = prepareInstitutionalChartDrawingInteraction({ tenantContext, institutionalChartDrawingInteractions: existing, institutionalChartWorkspace: options.institutionalChartWorkspace, institutionalChartLayout: options.institutionalChartLayout }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'institutional-chart-drawing-interactions', status: institutionalChartDrawingInteraction.institutionalChartDrawingInteractionStatus }), institutionalChartDrawingInteraction, chartingOnly: true, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'paperTrading.read', workspaceAction: 'read', routeId: 'institutional-chart-drawing-interactions', ...options })
}

export const handler = createInstitutionalChartDrawingInteractionsHandler()
