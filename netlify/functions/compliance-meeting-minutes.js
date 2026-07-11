import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createComplianceMeetingMinutesRepository, recordComplianceMeetingMinutes } from '../../lib/system/complianceMeetingMinutesEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'compliance meeting minutes access denied', { statusCode: 403, publicMessage: 'compliance meeting minutes access denied' })
}

export function createComplianceMeetingMinutesHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.complianceMeetingMinutesRepository ?? createComplianceMeetingMinutesRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const response = await repository.create({ ...body.minutes, tenantContext, recordedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-meeting-minutes', status: response.ok ? 'recorded' : 'blocked' }), minutes: response.minutes, automaticDistribution: false, automaticApproval: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, minutesStatus: query.minutesStatus, limit: query.limit }) ?? []
    const complianceMeetingMinutes = recordComplianceMeetingMinutes({ tenantContext, complianceMeetingMinutes: existing, complianceBoardPacket: options.complianceBoardPacket, complianceGovernanceDecisionLog: options.complianceGovernanceDecisionLog, complianceExamReadiness: options.complianceExamReadiness }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-meeting-minutes', status: complianceMeetingMinutes.meetingMinutesStatus }), complianceMeetingMinutes, automaticDistribution: false, automaticApproval: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'compliance-meeting-minutes', ...options })
}

export const handler = createComplianceMeetingMinutesHandler()
