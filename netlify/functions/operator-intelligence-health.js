import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { evaluateOperatorIntelligenceCommandCenter } from '../../lib/system/operatorIntelligenceCommandCenterEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'operator intelligence health access denied', {
      statusCode: 403,
      publicMessage: 'operator intelligence health access denied',
    })
  }
}

export function createOperatorIntelligenceHealthHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, membership }) => {
    assertOwnerAdmin(membership)
    const commandCenter = evaluateOperatorIntelligenceCommandCenter({
      operatorAttention: options.operatorAttention,
      administrativeCases: options.administrativeCases,
      userActivityRiskReview: options.userActivityRiskReview,
      notificationDigest: options.notificationDigest,
      administrationWorkflowSla: options.administrationWorkflowSla,
      tenantAdministrationOperations: options.tenantAdministrationOperations,
      tenantOperationsHealth: options.tenantOperationsHealth,
    }, { emitEvent: false })
    return {
      event: apiFoundationEvent({ requestId, endpoint: 'operator-intelligence-health', status: commandCenter.commandCenterStatus }),
      commandCenter,
      safeSummariesOnly: true,
      sensitiveMaterialExcluded: true,
      paperTrading: true,
      liveOrders: false,
      brokerExecution: false,
    }
  }, {
    allowedMethods: ['GET'],
    requiredPermission: 'workspace.admin',
    workspaceAction: 'administer',
    routeId: 'operator-intelligence-health',
    ...options,
  })
}

export const handler = createOperatorIntelligenceHealthHandler()
