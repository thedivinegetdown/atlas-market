import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createComplianceBoardPacketRepository, prepareComplianceBoardPacket } from '../../lib/system/complianceBoardPacketEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'compliance board packet access denied', { statusCode: 403, publicMessage: 'compliance board packet access denied' })
}

export function createComplianceBoardPacketsHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertOwnerAdmin(membership)
    const repository = options.complianceBoardPacketRepository ?? createComplianceBoardPacketRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const response = await repository.create({ ...body.packet, tenantContext, preparedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-board-packets', status: response.ok ? 'prepared' : 'blocked' }), packet: response.packet, automaticDistribution: false, automaticApproval: false, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, packetStatus: query.packetStatus, limit: query.limit }) ?? []
    const complianceBoardPacket = prepareComplianceBoardPacket({ tenantContext, complianceBoardPackets: existing, complianceGovernanceReadout: options.complianceGovernanceReadout, complianceGovernanceDecisionLog: options.complianceGovernanceDecisionLog, complianceRecordRetentionReview: options.complianceRecordRetentionReview, complianceExamReadiness: options.complianceExamReadiness }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'compliance-board-packets', status: complianceBoardPacket.boardPacketStatus }), complianceBoardPacket, automaticDistribution: false, automaticApproval: false, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'workspace.admin', workspaceAction: 'administer', routeId: 'compliance-board-packets', ...options })
}

export const handler = createComplianceBoardPacketsHandler()
