import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { evaluateTenantIsolation } from '../../lib/auth/tenantIsolation.js'
import { planTenantBackupRecovery } from '../../lib/system/tenantBackupRecoveryPlanningEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'tenant recovery planning access denied', {
      statusCode: 403,
      publicMessage: 'tenant recovery planning access denied',
    })
  }
}

export function createTenantBackupRecoveryPlanHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, membership, tenantContext }) => {
    assertOwnerAdmin(membership)
    const tenantIsolation = evaluateTenantIsolation(tenantContext, { emitEvent: false })
    const plan = planTenantBackupRecovery({
      tenantIsolation,
      dataRetention: options.dataRetention,
      dataLineage: options.dataLineage,
      persistenceApiIntegration: options.persistenceApiIntegration,
      productionOperationsRunbook: options.productionOperationsRunbook,
      eventObservability: options.eventObservability,
      operatorActions: options.operatorActions,
      enterpriseAuditTrail: options.enterpriseAuditTrail,
    }, { emitEvent: false })
    return {
      event: apiFoundationEvent({ requestId, endpoint: 'tenant-backup-recovery-plan', status: plan.backupReadinessStatus }),
      plan,
      realBackupPerformed: false,
      restorePerformed: false,
      dataMutated: false,
      credentialsIncluded: false,
      paperTrading: true,
      liveOrders: false,
      brokerExecution: false,
    }
  }, {
    allowedMethods: ['GET'],
    requiredPermission: 'workspace.admin',
    workspaceAction: 'administer',
    routeId: 'tenant-backup-recovery-plan',
    ...options,
  })
}

export const handler = createTenantBackupRecoveryPlanHandler()
