import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createComplianceAdoptionMonitoringRepository, evaluateComplianceAdoptionMonitoring } from '../../lib/system/complianceAdoptionMonitoringEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'compliance adoption monitoring access denied', { statusCode: 403, publicMessage: 'compliance adoption monitoring access denied' })
}

export function createComplianceAdoptionMonitoringHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.complianceAdoptionMonitoringRepository ?? createComplianceAdoptionMonitoringRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const response = await repository.create({ ...body.monitoring, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-adoption-monitoring', status: response.ok ? 'evaluated' : 'blocked' }), monitoring: response.monitoring, automaticMonitoringAction: false, automaticAdoption: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, monitoringStatus: query.monitoringStatus, limit: query.limit }) ?? []
    const complianceAdoptionMonitoring = evaluateComplianceAdoptionMonitoring({ tenantContext, complianceAdoptionMonitoring: existing, complianceImprovementBacklog: options.complianceImprovementBacklog, complianceProgramHealth: options.complianceProgramHealth, complianceExecutiveDashboard: options.complianceExecutiveDashboard }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-adoption-monitoring', status: complianceAdoptionMonitoring.adoptionMonitoringStatus }), complianceAdoptionMonitoring, automaticMonitoringAction: false, automaticAdoption: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'compliance-adoption-monitoring', ...options })
}

export const handler = createComplianceAdoptionMonitoringHandler()
