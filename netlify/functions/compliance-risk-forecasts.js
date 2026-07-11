import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createComplianceRiskForecastRepository, evaluateComplianceRiskForecast } from '../../lib/system/complianceRiskForecastEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'compliance risk forecast access denied', { statusCode: 403, publicMessage: 'compliance risk forecast access denied' })
}

export function createComplianceRiskForecastsHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.complianceRiskForecastRepository ?? createComplianceRiskForecastRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const response = await repository.create({ ...body.forecast, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-risk-forecasts', status: response.ok ? 'evaluated' : 'blocked' }), forecast: response.forecast, automaticRemediation: false, automaticComplianceClaims: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, forecastStatus: query.forecastStatus, limit: query.limit }) ?? []
    const complianceRiskForecast = evaluateComplianceRiskForecast({ tenantContext, complianceRiskForecasts: existing, complianceTrendAnalytics: options.complianceTrendAnalytics, complianceProgramHealth: options.complianceProgramHealth, complianceGovernanceActionItems: options.complianceGovernanceActionItems }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-risk-forecasts', status: complianceRiskForecast.riskForecastStatus }), complianceRiskForecast, automaticRemediation: false, automaticComplianceClaims: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'compliance-risk-forecasts', ...options })
}

export const handler = createComplianceRiskForecastsHandler()
