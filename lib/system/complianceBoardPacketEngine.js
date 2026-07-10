import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SYSTEM_COMPLIANCE_BOARD_PACKET_PREPARED_EVENT = 'system.complianceBoardPacket.prepared'

export const BOARD_PACKET_STATUSES = Object.freeze(['draft', 'ready_for_review', 'needs_updates', 'reviewed'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeStatus(status) {
  return BOARD_PACKET_STATUSES.includes(status) ? status : 'draft'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

export function normalizeComplianceBoardPacket(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    id: String(input.id ?? `compliance-board-packet-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    packetStatus: safeStatus(input.packetStatus ?? input.status),
    packetAudience: input.packetAudience ?? 'owner-admin-governance-review',
    packetSummary: String(input.packetSummary ?? 'Compliance board packet prepared for human review.').slice(0, 700),
    sourceReferences: (input.sourceReferences ?? []).map(normalizeReference),
    agendaItems: (input.agendaItems ?? []).map((item) => String(item).slice(0, 220)),
    preparedByUserId: input.preparedByUserId ?? tenantScope.userId ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    humanReviewOnly: true,
    automaticDistribution: false,
    automaticApproval: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    sensitiveMaterialExcluded: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createComplianceBoardPacketRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(packetInput) {
      const packet = normalizeComplianceBoardPacket(packetInput)
      if (!database?.connected) return { ok: true, disabled: true, packet }
      const result = await database.query(
        `INSERT INTO atlas_compliance_board_packets
          (id, organization_id, team_workspace_id, packet_status, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET packet_status = EXCLUDED.packet_status, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [packet.id, packet.tenantScope.organizationId, packet.tenantScope.teamWorkspaceId, packet.packetStatus, packet],
      )
      return { ok: true, packet: normalizeComplianceBoardPacket(result.rows?.[0]?.payload ?? packet) }
    },
    async list({ tenantContext = {}, packetStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (packetStatus) {
        params.push(safeStatus(packetStatus))
        clauses.push(`packet_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_compliance_board_packets
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeComplianceBoardPacket(row.payload))
    },
  }
}

export function prepareComplianceBoardPacket(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.complianceBoardPackets ?? []
  const readout = input.complianceGovernanceReadout ?? {}
  const decisionLog = input.complianceGovernanceDecisionLog ?? {}
  const retentionReview = input.complianceRecordRetentionReview ?? {}
  const examReadiness = input.complianceExamReadiness ?? {}
  const needsUpdates = decisionLog.decisionLogStatus === 'caution' || retentionReview.retentionReviewStatus === 'caution' || examReadiness.examReadinessStatus === 'blocked'
  const packets = (supplied.length ? supplied : [normalizeComplianceBoardPacket({
    tenantContext,
    packetStatus: needsUpdates ? 'needs_updates' : 'ready_for_review',
    packetSummary: `Compliance board packet summarizes governance readouts, decision log status, record retention review, and exam readiness for owner/admin review.`,
    sourceReferences: [
      { id: 'compliance-governance-readout', type: 'compliance-governance-readout', eventType: readout.eventType },
      { id: 'compliance-governance-decision', type: 'compliance-governance-decision-log', eventType: decisionLog.eventType },
      { id: 'compliance-record-retention', type: 'compliance-record-retention-review', eventType: retentionReview.eventType },
      { id: 'compliance-exam-readiness', type: 'compliance-exam-readiness', eventType: examReadiness.eventType },
    ],
    agendaItems: ['Review compliance readout', 'Review decision log', 'Review retention items', 'Review exam readiness gaps'],
    timestamp: options.timestamp,
  })]).map(normalizeComplianceBoardPacket)
  const boardPacketSummary = {
    total: packets.length,
    readyForReview: packets.filter((item) => item.packetStatus === 'ready_for_review').length,
    needsUpdates: packets.filter((item) => item.packetStatus === 'needs_updates').length,
    reviewed: packets.filter((item) => item.packetStatus === 'reviewed').length,
  }
  const boardPacketStatus = boardPacketSummary.needsUpdates > 0 ? 'caution' : boardPacketSummary.readyForReview > 0 ? 'ready' : 'caution'
  const result = {
    eventType: SYSTEM_COMPLIANCE_BOARD_PACKET_PREPARED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    complianceBoardPackets: packets,
    boardPacketSummary,
    boardPacketStatus,
    humanReviewOnly: true,
    automaticDistribution: false,
    automaticApproval: false,
    automaticComplianceClaims: false,
    destructiveAutomation: false,
    safeSummariesOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    summary: `Compliance board packet ${boardPacketStatus}: ${boardPacketSummary.readyForReview} ready for review and ${boardPacketSummary.needsUpdates} needing updates.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SYSTEM_COMPLIANCE_BOARD_PACKET_PREPARED_EVENT, result)
  return result
}
