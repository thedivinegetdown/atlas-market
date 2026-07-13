import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createInstitutionalChartWorkspaceRepository, prepareInstitutionalChartWorkspace } from '../../lib/system/institutionalChartWorkspaceEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertChartWorkspaceAccess(membership) {
  if (!['owner', 'admin', 'analyst'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Institutional chart workspace access denied', { statusCode: 403, publicMessage: 'Institutional chart workspace access denied' })
}

export function createInstitutionalChartWorkspacesHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertChartWorkspaceAccess(membership)
    const repository = options.institutionalChartWorkspaceRepository ?? createInstitutionalChartWorkspaceRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const persistence = await repository.create({ ...body.workspace, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'institutional-chart-workspaces', status: persistence.ok ? 'prepared' : 'blocked' }), workspace: persistence.workspace, chartingOnly: true, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, workspaceStatus: query.workspaceStatus, limit: query.limit }) ?? []
    const institutionalChartWorkspace = prepareInstitutionalChartWorkspace({ tenantContext, institutionalChartWorkspaces: existing, marketDataAdapterHealth: options.marketDataAdapterHealth, historicalReplay: options.historicalReplay, workspacePersistence: options.workspacePersistence }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'institutional-chart-workspaces', status: institutionalChartWorkspace.institutionalChartWorkspaceStatus }), institutionalChartWorkspace, chartingOnly: true, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'paperTrading.read', workspaceAction: 'read', routeId: 'institutional-chart-workspaces', ...options })
}

export const handler = createInstitutionalChartWorkspacesHandler()
