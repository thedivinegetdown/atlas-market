import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { captureComplianceMetricsSnapshot, createComplianceMetricsSnapshotRepository } from '../../lib/system/complianceMetricsSnapshotEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'compliance metrics snapshot access denied', { statusCode: 403, publicMessage: 'compliance metrics snapshot access denied' })
}

export function createComplianceMetricsSnapshotsHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.complianceMetricsSnapshotRepository ?? createComplianceMetricsSnapshotRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const response = await repository.create({ ...body.snapshot, tenantContext, capturedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-metrics-snapshots', status: response.ok ? 'captured' : 'blocked' }), snapshot: response.snapshot, automaticDistribution: false, automaticComplianceClaims: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, snapshotStatus: query.snapshotStatus, limit: query.limit }) ?? []
    const complianceMetricsSnapshot = captureComplianceMetricsSnapshot({ tenantContext, complianceMetricsSnapshots: existing, complianceProgramHealth: options.complianceProgramHealth, complianceGovernanceActionItems: options.complianceGovernanceActionItems, complianceExamReadiness: options.complianceExamReadiness, complianceMeetingMinutes: options.complianceMeetingMinutes }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-metrics-snapshots', status: complianceMetricsSnapshot.metricsSnapshotStatus }), complianceMetricsSnapshot, automaticDistribution: false, automaticComplianceClaims: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'compliance-metrics-snapshots', ...options })
}

export const handler = createComplianceMetricsSnapshotsHandler()
