import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createInstitutionalChartLayoutRepository, synchronizeInstitutionalChartLayout } from '../../lib/system/institutionalChartLayoutEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertChartLayoutAccess(membership) {
  if (!['owner', 'admin', 'analyst'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Institutional chart layout access denied', { statusCode: 403, publicMessage: 'Institutional chart layout access denied' })
}

export function createInstitutionalChartLayoutsHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertChartLayoutAccess(membership)
    const repository = options.institutionalChartLayoutRepository ?? createInstitutionalChartLayoutRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const persistence = await repository.create({ ...body.layout, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'institutional-chart-layouts', status: persistence.ok ? 'synchronized' : 'blocked' }), layout: persistence.layout, chartingOnly: true, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, layoutStatus: query.layoutStatus, limit: query.limit }) ?? []
    const institutionalChartLayout = synchronizeInstitutionalChartLayout({ tenantContext, institutionalChartLayouts: existing, institutionalChartWorkspace: options.institutionalChartWorkspace }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'institutional-chart-layouts', status: institutionalChartLayout.institutionalChartLayoutStatus }), institutionalChartLayout, chartingOnly: true, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'paperTrading.read', workspaceAction: 'read', routeId: 'institutional-chart-layouts', ...options })
}

export const handler = createInstitutionalChartLayoutsHandler()
