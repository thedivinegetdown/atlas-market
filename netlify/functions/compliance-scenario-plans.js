import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createComplianceScenarioPlanningRepository, evaluateComplianceScenarioPlanning } from '../../lib/system/complianceScenarioPlanningEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'compliance scenario planning access denied', { statusCode: 403, publicMessage: 'compliance scenario planning access denied' })
}

export function createComplianceScenarioPlansHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.complianceScenarioPlanningRepository ?? createComplianceScenarioPlanningRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const response = await repository.create({ ...body.scenario, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-scenario-plans', status: response.ok ? 'evaluated' : 'blocked' }), scenario: response.scenario, automaticRemediation: false, automaticComplianceClaims: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, scenarioStatus: query.scenarioStatus, limit: query.limit }) ?? []
    const complianceScenarioPlanning = evaluateComplianceScenarioPlanning({ tenantContext, complianceScenarioPlans: existing, complianceRiskForecast: options.complianceRiskForecast, complianceBenchmarkComparison: options.complianceBenchmarkComparison }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-scenario-plans', status: complianceScenarioPlanning.scenarioPlanningStatus }), complianceScenarioPlanning, automaticRemediation: false, automaticComplianceClaims: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'compliance-scenario-plans', ...options })
}

export const handler = createComplianceScenarioPlansHandler()
