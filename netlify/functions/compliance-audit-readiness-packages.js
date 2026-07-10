import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createComplianceAuditReadinessPackageRepository, prepareComplianceAuditReadinessPackage } from '../../lib/system/complianceAuditReadinessPackageEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'compliance audit readiness access denied', { statusCode: 403, publicMessage: 'compliance audit readiness access denied' })
}

export function createComplianceAuditReadinessPackagesHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.complianceAuditReadinessPackageRepository ?? createComplianceAuditReadinessPackageRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const response = await repository.create({ ...body.readinessPackage, tenantContext, preparedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-audit-readiness-packages', status: response.ok ? 'prepared' : 'blocked' }), readinessPackage: response.readinessPackage, automaticExport: false, automaticComplianceClaims: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, readinessStatus: query.readinessStatus, limit: query.limit }) ?? []
    const complianceAuditReadinessPackage = prepareComplianceAuditReadinessPackage({
      tenantContext,
      complianceAuditReadinessPackages: existing,
      complianceEvidencePackage: options.complianceEvidencePackage,
      complianceEvidenceRequestQueue: options.complianceEvidenceRequestQueue,
      complianceReviewFindingTracker: options.complianceReviewFindingTracker,
      complianceRiskCommandCenter: options.complianceRiskCommandCenter,
      complianceGovernanceReadout: options.complianceGovernanceReadout,
      enterpriseAuditTrail: options.enterpriseAuditTrail,
      dataLineage: options.dataLineage,
    }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-audit-readiness-packages', status: complianceAuditReadinessPackage.auditReadinessStatus }), complianceAuditReadinessPackage, automaticExport: false, automaticComplianceClaims: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'compliance-audit-readiness-packages', ...options })
}

export const handler = createComplianceAuditReadinessPackagesHandler()
