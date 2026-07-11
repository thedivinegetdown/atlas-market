import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createComplianceTrendAnalyticsRepository, evaluateComplianceTrendAnalytics } from '../../lib/system/complianceTrendAnalyticsEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'compliance trend analytics access denied', { statusCode: 403, publicMessage: 'compliance trend analytics access denied' })
}

export function createComplianceTrendAnalyticsHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.complianceTrendAnalyticsRepository ?? createComplianceTrendAnalyticsRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const response = await repository.create({ ...body.analytics, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-trend-analytics', status: response.ok ? 'evaluated' : 'blocked' }), analytics: response.analytics, automaticComplianceClaims: false, destructiveAutomation: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, trendStatus: query.trendStatus, limit: query.limit }) ?? []
    const complianceTrendAnalytics = evaluateComplianceTrendAnalytics({ tenantContext, complianceTrendAnalytics: existing, complianceMetricsSnapshot: options.complianceMetricsSnapshot, complianceExecutiveDashboard: options.complianceExecutiveDashboard }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-trend-analytics', status: complianceTrendAnalytics.trendAnalyticsStatus }), complianceTrendAnalytics, automaticComplianceClaims: false, destructiveAutomation: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'compliance-trend-analytics', ...options })
}

export const handler = createComplianceTrendAnalyticsHandler()
