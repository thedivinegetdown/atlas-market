import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { buildAdministrativeCases, createAdministrativeCase, createAdministrativeCaseRepository } from '../../lib/system/administrativeCaseManagementEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'administrative case access denied', {
      statusCode: 403,
      publicMessage: 'administrative case access denied',
    })
  }
}

export function createAdministrativeCasesHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.caseRepository ?? createAdministrativeCaseRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const created = await createAdministrativeCase({
        case: { ...body.case, tenantContext, ownerUserId: tenantContext.userId },
      }, { repository, emitEvent: false })
      return {
        event: apiFoundationEvent({ requestId, endpoint: 'administrative-cases', status: created.status }),
        created,
        humanReviewOnly: true,
        paperTrading: true,
        liveOrders: false,
        brokerExecution: false,
      }
    }
    const existingCases = await repository.list?.({ tenantContext, status: query.status, limit: query.limit }) ?? []
    const cases = buildAdministrativeCases({
      tenantContext,
      existingCases,
      operatorAttention: options.operatorAttention,
      userActivityRiskReview: options.userActivityRiskReview,
      administrationWorkflowSla: options.administrationWorkflowSla,
    }, { emitEvent: false })
    return {
      event: apiFoundationEvent({ requestId, endpoint: 'administrative-cases', status: cases.status }),
      cases,
      pagination: { limit: Math.min(100, Math.max(1, Number(query.limit ?? 50) || 50)), returned: cases.administrativeCases.length },
      humanReviewOnly: true,
      paperTrading: true,
      liveOrders: false,
      brokerExecution: false,
    }
  }, {
    allowedMethods: ['GET', 'POST'],
    requiredPermission: 'workspace.admin',
    workspaceAction: 'administer',
    routeId: 'administrative-cases',
    ...options,
  })
}

export const handler = createAdministrativeCasesHandler()
