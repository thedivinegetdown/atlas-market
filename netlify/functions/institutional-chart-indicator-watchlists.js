import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createInstitutionalChartIndicatorWatchlistRepository, prepareInstitutionalChartIndicatorWatchlist } from '../../lib/system/institutionalChartIndicatorWatchlistEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertChartAccess(membership) {
  if (!['owner', 'admin', 'analyst'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Institutional chart indicator watchlist access denied', { statusCode: 403, publicMessage: 'Institutional chart indicator watchlist access denied' })
}

export function createInstitutionalChartIndicatorWatchlistsHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertChartAccess(membership)
    const repository = options.institutionalChartIndicatorWatchlistRepository ?? createInstitutionalChartIndicatorWatchlistRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const persistence = await repository.create({ ...body.state, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'institutional-chart-indicator-watchlists', status: persistence.ok ? 'prepared' : 'blocked' }), state: persistence.state, chartingOnly: true, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, indicatorWatchlistStatus: query.indicatorWatchlistStatus, limit: query.limit }) ?? []
    const institutionalChartIndicatorWatchlist = prepareInstitutionalChartIndicatorWatchlist({ tenantContext, institutionalChartIndicatorWatchlists: existing, institutionalChartWorkspace: options.institutionalChartWorkspace, institutionalChartIndicatorTemplate: options.institutionalChartIndicatorTemplate, institutionalChartAdvancedDrawingSync: options.institutionalChartAdvancedDrawingSync }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'institutional-chart-indicator-watchlists', status: institutionalChartIndicatorWatchlist.institutionalChartIndicatorWatchlistStatus }), institutionalChartIndicatorWatchlist, chartingOnly: true, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'paperTrading.read', workspaceAction: 'read', routeId: 'institutional-chart-indicator-watchlists', ...options })
}

export const handler = createInstitutionalChartIndicatorWatchlistsHandler()
