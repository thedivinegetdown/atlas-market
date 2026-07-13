import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const PAPER_RISK_REALTIME_MONITORED_EVENT = 'paperRisk.realtime.monitored'
export const REALTIME_PAPER_RISK_STATUSES = Object.freeze(['healthy', 'caution', 'elevated', 'blocked'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function numberValue(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

function round(value, decimals = 2) {
  return Number(numberValue(value).toFixed(decimals))
}

function normalizeTenantScope(input = {}) {
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  return {
    organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
    teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
    userId: tenantScope.userId ?? input.userId ?? null,
    role: tenantScope.role ?? input.role ?? null,
  }
}

function normalizeReference(reference = {}) {
  if (!reference) return null
  return {
    id: reference.id ?? null,
    eventType: reference.eventType ?? reference.type ?? null,
    status: reference.status ?? reference.riskStatus ?? reference.reconciliationStatus ?? reference.streamingPortfolioStatus ?? null,
  }
}

function safeStatus(status) {
  return REALTIME_PAPER_RISK_STATUSES.includes(status) ? status : 'blocked'
}

function resolveStatus({ portfolioStream, reconciliation, portfolioRisk, drawdownProtection }) {
  if (!portfolioStream || !reconciliation || !portfolioRisk || !drawdownProtection) return 'blocked'
  if (reconciliation.reconciliationStatus === 'blocked' || portfolioStream.streamingPortfolioStatus === 'blocked') return 'blocked'
  if (reconciliation.reconciliationStatus === 'mismatch' || drawdownProtection.protectionStatus === 'locked' || portfolioRisk.summary?.riskLevel === 'critical') return 'elevated'
  if (reconciliation.reconciliationStatus === 'caution' || portfolioStream.streamingPortfolioStatus !== 'healthy' || drawdownProtection.protectionStatus === 'caution' || ['high', 'elevated'].includes(portfolioRisk.summary?.riskLevel)) return 'caution'
  return 'healthy'
}

export function normalizeRealtimePaperRiskSnapshot(input = {}, index = 0) {
  const timestamp = input.createdAt ?? input.timestamp ?? getNowIso()
  return {
    id: String(input.id ?? `realtime-paper-risk-${input.accountId ?? 'paper'}-${Date.parse(timestamp) || Date.now()}-${index + 1}`).slice(0, 220),
    tenantScope: normalizeTenantScope(input),
    accountId: String(input.accountId ?? 'paper-portfolio').slice(0, 120),
    riskStatus: safeStatus(input.riskStatus ?? input.status),
    cashRiskSummary: input.cashRiskSummary ?? { status: 'blocked' },
    equityRiskSummary: input.equityRiskSummary ?? { status: 'blocked' },
    exposureRiskSummary: input.exposureRiskSummary ?? { status: 'blocked' },
    drawdownRiskSummary: input.drawdownRiskSummary ?? { status: 'blocked' },
    reconciliationRiskSummary: input.reconciliationRiskSummary ?? { status: 'blocked' },
    guardrailRiskSummary: input.guardrailRiskSummary ?? { status: 'blocked' },
    latestPortfolioReference: normalizeReference(input.latestPortfolioReference),
    latestReconciliationReference: normalizeReference(input.latestReconciliationReference),
    portfolioRiskReference: normalizeReference(input.portfolioRiskReference),
    drawdownProtectionReference: normalizeReference(input.drawdownProtectionReference),
    riskIssues: (input.riskIssues ?? []).slice(0, 20).map(String),
    createdAt: timestamp,
    updatedAt: input.updatedAt ?? timestamp,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    automaticTrading: false,
  }
}

export function createRealtimePaperRiskRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const risk = normalizeRealtimePaperRiskSnapshot(input)
      if (!database?.connected) return { ok: true, disabled: true, risk }
      const result = await database.query(
        `INSERT INTO atlas_realtime_paper_risk_snapshots
          (id, organization_id, team_workspace_id, account_id, risk_status, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET risk_status = EXCLUDED.risk_status, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [risk.id, risk.tenantScope.organizationId, risk.tenantScope.teamWorkspaceId, risk.accountId, risk.riskStatus, risk],
      )
      return { ok: true, risk: normalizeRealtimePaperRiskSnapshot(result.rows?.[0]?.payload ?? risk) }
    },
    async list({ tenantContext = {}, accountId, riskStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (accountId) {
        params.push(String(accountId))
        clauses.push(`account_id = $${params.length}`)
      }
      if (riskStatus) {
        params.push(safeStatus(riskStatus))
        clauses.push(`risk_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_realtime_paper_risk_snapshots
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeRealtimePaperRiskSnapshot(row.payload))
    },
  }
}

export function monitorRealtimePaperRisk(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? getNowIso()
  const tenantContext = input.tenantContext ?? {}
  const portfolioStream = input.realtimePaperPortfolio ?? input.paperPortfolio
  const reconciliation = input.realtimePortfolioReconciliation?.realtimePortfolioReconciliations?.[0] ?? input.reconciliation
  const portfolioRisk = input.portfolioRisk
  const drawdownProtection = input.drawdownProtection
  const hasTenantContext = Boolean(tenantContext.organizationId && tenantContext.userId)
  const status = hasTenantContext ? resolveStatus({ portfolioStream, reconciliation, portfolioRisk, drawdownProtection }) : 'blocked'
  const riskIssues = []
  if (!tenantContext.organizationId || !tenantContext.userId) riskIssues.push('tenant context is required')
  if (!portfolioStream) riskIssues.push('real-time portfolio stream is required')
  if (!reconciliation) riskIssues.push('latest reconciliation is required')
  if (!portfolioRisk) riskIssues.push('portfolio risk snapshot is required')
  if (!drawdownProtection) riskIssues.push('drawdown protection snapshot is required')
  if (reconciliation?.reconciliationStatus === 'mismatch') riskIssues.push('latest reconciliation mismatch')
  if (drawdownProtection?.protectionStatus === 'locked') riskIssues.push('drawdown protection locked')

  const snapshot = normalizeRealtimePaperRiskSnapshot({
    tenantContext,
    accountId: input.accountId ?? portfolioStream?.accountId ?? reconciliation?.accountId,
    riskStatus: riskIssues.length && status === 'healthy' ? 'caution' : status,
    cashRiskSummary: {
      status: numberValue(portfolioStream?.currentCashSummary?.cash) >= 0 ? 'healthy' : 'elevated',
      cash: round(portfolioStream?.currentCashSummary?.cash),
    },
    equityRiskSummary: {
      status: numberValue(portfolioStream?.currentEquitySummary?.equity) > 0 ? 'healthy' : 'blocked',
      equity: round(portfolioStream?.currentEquitySummary?.equity),
    },
    exposureRiskSummary: {
      status: portfolioRisk?.summary?.riskLevel ?? 'blocked',
      grossExposure: round(portfolioStream?.exposureSummaryReferences?.grossExposure),
      netExposure: round(portfolioStream?.exposureSummaryReferences?.netExposure),
    },
    drawdownRiskSummary: {
      status: drawdownProtection?.protectionStatus ?? 'blocked',
      currentDrawdown: round(drawdownProtection?.currentDrawdown),
      recommendedAction: drawdownProtection?.recommendedAction ?? null,
    },
    reconciliationRiskSummary: {
      status: reconciliation?.reconciliationStatus ?? 'blocked',
      issues: reconciliation?.reconciliationIssues ?? [],
    },
    guardrailRiskSummary: {
      status: input.latestGuardrailEvaluation?.guardrailDecision ?? input.latestGuardrailEvaluation?.status ?? 'referenced',
      latestGuardrailReference: normalizeReference(input.latestGuardrailEvaluation),
    },
    latestPortfolioReference: { id: portfolioStream?.accountId, eventType: portfolioStream?.eventType, status: portfolioStream?.streamingPortfolioStatus },
    latestReconciliationReference: reconciliation ? { id: reconciliation.id, eventType: reconciliation.eventType ?? 'paperPortfolio.realtime.reconciled', status: reconciliation.reconciliationStatus } : null,
    portfolioRiskReference: { id: 'portfolio-risk', eventType: portfolioRisk?.eventType, status: portfolioRisk?.summary?.riskLevel },
    drawdownProtectionReference: { id: 'drawdown-protection', eventType: drawdownProtection?.eventType, status: drawdownProtection?.protectionStatus },
    riskIssues,
    timestamp,
  })
  const result = {
    eventType: PAPER_RISK_REALTIME_MONITORED_EVENT,
    timestamp,
    realtimePaperRiskSnapshot: snapshot,
    realtimePaperRiskSummary: {
      riskStatus: snapshot.riskStatus,
      issueCount: snapshot.riskIssues.length,
      paperModeInvariant: true,
    },
    riskStatus: snapshot.riskStatus,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    automaticTrading: false,
    summary: `Real-time paper risk monitor ${snapshot.riskStatus}: cash ${snapshot.cashRiskSummary.status}, exposure ${snapshot.exposureRiskSummary.status}, drawdown ${snapshot.drawdownRiskSummary.status}, reconciliation ${snapshot.reconciliationRiskSummary.status}.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(PAPER_RISK_REALTIME_MONITORED_EVENT, result)
  return result
}
