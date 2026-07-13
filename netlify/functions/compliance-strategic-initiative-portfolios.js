import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createComplianceStrategicInitiativePortfolioRepository, evaluateComplianceStrategicInitiativePortfolio } from '../../lib/system/complianceStrategicInitiativePortfolioEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'compliance strategic initiative access denied', { statusCode: 403, publicMessage: 'compliance strategic initiative access denied' })
}

export function createComplianceStrategicInitiativePortfoliosHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.complianceStrategicInitiativePortfolioRepository ?? createComplianceStrategicInitiativePortfolioRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const response = await repository.create({ ...body.initiative, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-strategic-initiative-portfolios', status: response.ok ? 'evaluated' : 'blocked' }), initiative: response.initiative, automaticInitiativeApproval: false, automaticFundingAction: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, initiativeStatus: query.initiativeStatus, limit: query.limit }) ?? []
    const complianceStrategicInitiativePortfolio = evaluateComplianceStrategicInitiativePortfolio({ tenantContext, complianceStrategicInitiativePortfolios: existing, complianceOptimizationRoadmap: options.complianceOptimizationRoadmap, complianceContinuousImprovementProgram: options.complianceContinuousImprovementProgram, complianceResourcePlanning: options.complianceResourcePlanning }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-strategic-initiative-portfolios', status: complianceStrategicInitiativePortfolio.strategicInitiativeStatus }), complianceStrategicInitiativePortfolio, automaticInitiativeApproval: false, automaticFundingAction: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'compliance-strategic-initiative-portfolios', ...options })
}

export const handler = createComplianceStrategicInitiativePortfoliosHandler()
