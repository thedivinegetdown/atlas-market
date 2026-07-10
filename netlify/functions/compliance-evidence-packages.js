import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createComplianceEvidencePackageRepository, prepareComplianceEvidencePackage } from '../../lib/system/complianceEvidencePackageEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'compliance evidence package access denied', { statusCode: 403, publicMessage: 'compliance evidence package access denied' })
}

export function createComplianceEvidencePackagesHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.complianceEvidencePackageRepository ?? createComplianceEvidencePackageRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const response = await repository.create({ ...body.evidencePackage, tenantContext, preparedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-evidence-packages', status: response.ok ? 'prepared' : 'blocked' }), evidencePackage: response.evidencePackage, sensitivePayloadCopied: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, packageStatus: query.packageStatus, limit: query.limit }) ?? []
    const complianceEvidencePackage = prepareComplianceEvidencePackage({ tenantContext, evidencePackages: existing, policyGovernance: options.policyGovernance, controlAssurance: options.controlAssurance, policyAttestation: options.policyAttestation, controlTesting: options.controlTesting, evidenceGovernance: options.evidenceGovernance, remediationEffectiveness: options.remediationEffectiveness }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-evidence-packages', status: complianceEvidencePackage.packageStatus }), complianceEvidencePackage, sensitivePayloadCopied: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'compliance-evidence-packages', ...options })
}

export const handler = createComplianceEvidencePackagesHandler()
