import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createComplianceOptimizationRoadmapRepository, planComplianceOptimizationRoadmap } from '../../lib/system/complianceOptimizationRoadmapEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'compliance optimization roadmap access denied', { statusCode: 403, publicMessage: 'compliance optimization roadmap access denied' })
}

export function createComplianceOptimizationRoadmapsHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.complianceOptimizationRoadmapRepository ?? createComplianceOptimizationRoadmapRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const response = await repository.create({ ...body.roadmap, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-optimization-roadmaps', status: response.ok ? 'planned' : 'blocked' }), roadmap: response.roadmap, automaticOptimization: false, automaticAssignment: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, roadmapStatus: query.roadmapStatus, limit: query.limit }) ?? []
    const complianceOptimizationRoadmap = planComplianceOptimizationRoadmap({ tenantContext, complianceOptimizationRoadmaps: existing, complianceContinuousImprovementProgram: options.complianceContinuousImprovementProgram, complianceBenchmarkComparison: options.complianceBenchmarkComparison, complianceResourcePlanning: options.complianceResourcePlanning }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-optimization-roadmaps', status: complianceOptimizationRoadmap.optimizationRoadmapStatus }), complianceOptimizationRoadmap, automaticOptimization: false, automaticAssignment: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'compliance-optimization-roadmaps', ...options })
}

export const handler = createComplianceOptimizationRoadmapsHandler()
