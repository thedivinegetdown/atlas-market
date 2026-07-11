import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createComplianceExecutiveDashboardRepository, evaluateComplianceExecutiveDashboard } from '../../lib/system/complianceExecutiveDashboardEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'compliance executive dashboard access denied', { statusCode: 403, publicMessage: 'compliance executive dashboard access denied' })
}

export function createComplianceExecutiveDashboardHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.complianceExecutiveDashboardRepository ?? createComplianceExecutiveDashboardRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const response = await repository.create({ ...body.dashboard, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-executive-dashboard', status: response.ok ? 'evaluated' : 'blocked' }), dashboard: response.dashboard, automaticDistribution: false, automaticComplianceClaims: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, dashboardStatus: query.dashboardStatus, limit: query.limit }) ?? []
    const complianceExecutiveDashboard = evaluateComplianceExecutiveDashboard({ tenantContext, complianceExecutiveDashboards: existing, complianceMetricsSnapshot: options.complianceMetricsSnapshot, complianceExecutiveSummary: options.complianceExecutiveSummary, complianceProgramHealth: options.complianceProgramHealth, complianceRiskCommandCenter: options.complianceRiskCommandCenter }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-executive-dashboard', status: complianceExecutiveDashboard.executiveDashboardStatus }), complianceExecutiveDashboard, automaticDistribution: false, automaticComplianceClaims: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'compliance-executive-dashboard', ...options })
}

export const handler = createComplianceExecutiveDashboardHandler()
