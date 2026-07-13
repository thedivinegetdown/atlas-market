import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const PAPER_DECISION_REALTIME_EVALUATED_EVENT = 'paperDecision.realtime.evaluated'
export const REALTIME_PAPER_DECISION_STATUSES = Object.freeze(['approved', 'caution', 'rejected', 'watchlist'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Number(value ?? 0)))
}

function normalizeReference(reference = {}) {
  if (!reference) return null
  return {
    id: reference.id ?? null,
    eventType: reference.eventType ?? reference.type ?? null,
    status: reference.status ?? reference.decisionStatus ?? reference.signalStatus ?? null,
  }
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

function safeStatus(status) {
  return REALTIME_PAPER_DECISION_STATUSES.includes(status) ? status : 'watchlist'
}

function hasUnsafeMode(input = {}) {
  return input.paperTrading === false || input.liveOrders === true || input.brokerExecution === true || input.accountMode === 'live' || input.executionMode === 'live'
}

function isPermittedSignal(signal = {}, allowWatchlist = false) {
  if (signal.signalStatus === 'qualified') return true
  return allowWatchlist && signal.signalStatus === 'watchlist'
}

function buildDecisionStatus({ signal, confidence, missingContext, unsafeMode }) {
  if (unsafeMode || missingContext.length > 0 || signal.signalStatus === 'rejected') return 'rejected'
  if (signal.signalStatus === 'watchlist') return 'watchlist'
  if (confidence >= 80) return 'approved'
  if (confidence >= 65) return 'caution'
  return 'watchlist'
}

export function normalizeRealtimePaperDecision(input = {}, index = 0) {
  const timestamp = input.createdAt ?? input.timestamp ?? getNowIso()
  const confidence = clampScore(input.decisionConfidence ?? input.confidence)
  const status = safeStatus(input.decisionStatus ?? input.status ?? (confidence >= 80 ? 'approved' : confidence >= 65 ? 'caution' : 'watchlist'))
  return {
    id: String(input.id ?? `realtime-paper-decision-${input.symbol ?? 'SPY'}-${Date.parse(timestamp) || Date.now()}-${index + 1}`).slice(0, 220),
    tenantScope: normalizeTenantScope(input),
    symbol: String(input.symbol ?? 'SPY').toUpperCase().slice(0, 24),
    assetType: String(input.assetType ?? 'etf').toLowerCase().slice(0, 40),
    decisionStatus: status,
    decisionConfidence: confidence,
    decisionAction: String(input.decisionAction ?? input.signalAction ?? 'WATCH').toUpperCase().slice(0, 40),
    decisionRationale: String(input.decisionRationale ?? input.rationale ?? 'Real-time paper decision evaluated against AI, research, market, risk, and strategy context.').slice(0, 800),
    sourceScannerReference: normalizeReference(input.sourceScannerReference),
    sourceSignalReference: normalizeReference(input.sourceSignalReference),
    sourceAlertReference: normalizeReference(input.sourceAlertReference),
    researchEnhancedDecisionReference: normalizeReference(input.researchEnhancedDecisionReference),
    marketRegimeReference: normalizeReference(input.marketRegimeReference),
    portfolioRiskReference: normalizeReference(input.portfolioRiskReference),
    drawdownProtectionReference: normalizeReference(input.drawdownProtectionReference),
    capitalAllocationReference: normalizeReference(input.capitalAllocationReference),
    strategyLifecycleReference: normalizeReference(input.strategyLifecycleReference),
    strategyRegistryReference: normalizeReference(input.strategyRegistryReference),
    rejectionReasons: (input.rejectionReasons ?? []).slice(0, 12).map(String),
    duplicateSuppressionKey: String(input.duplicateSuppressionKey ?? `${input.symbol ?? 'SPY'}:${input.sourceSignalReference?.id ?? input.id ?? 'signal'}`).slice(0, 260),
    createdAt: timestamp,
    updatedAt: input.updatedAt ?? timestamp,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    automaticTrading: false,
  }
}

export function createRealtimePaperDecisionRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const decision = normalizeRealtimePaperDecision(input)
      if (!database?.connected) return { ok: true, disabled: true, decision }
      const result = await database.query(
        `INSERT INTO atlas_realtime_paper_decisions
          (id, organization_id, team_workspace_id, decision_status, symbol, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET decision_status = EXCLUDED.decision_status, symbol = EXCLUDED.symbol, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [decision.id, decision.tenantScope.organizationId, decision.tenantScope.teamWorkspaceId, decision.decisionStatus, decision.symbol, decision],
      )
      return { ok: true, decision: normalizeRealtimePaperDecision(result.rows?.[0]?.payload ?? decision) }
    },
    async list({ tenantContext = {}, decisionStatus, symbol, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (decisionStatus) {
        params.push(safeStatus(decisionStatus))
        clauses.push(`decision_status = $${params.length}`)
      }
      if (symbol) {
        params.push(String(symbol).toUpperCase())
        clauses.push(`symbol = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_realtime_paper_decisions
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeRealtimePaperDecision(row.payload))
    },
  }
}

export function evaluateRealtimePaperDecisions(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? getNowIso()
  const tenantContext = input.tenantContext ?? {}
  const allowWatchlist = input.allowWatchlistSignals === true
  const signals = input.realtimeSignals?.realtimeSignalEvaluations ?? input.signals ?? []
  const existingKeys = new Set((input.existingDecisions ?? []).map((decision) => decision.duplicateSuppressionKey))
  const alertsBySignalId = new Map((input.realtimeAlerts?.realtimeAlerts ?? input.alerts ?? [])
    .map((alert) => [alert.sourceSignalReference?.id, alert]))
  const contextRefs = {
    researchEnhancedDecisionReference: { id: 'research-enhanced-decision', eventType: input.researchEnhancedDecision?.eventType, status: input.researchEnhancedDecision?.decisionSummary?.decision ?? input.researchEnhancedDecision?.finalDecision },
    marketRegimeReference: { id: 'market-regime', eventType: input.marketRegimeClassification?.eventType ?? input.marketRegime?.eventType, status: input.marketRegimeClassification?.compositeRegimeLabel ?? input.marketRegime?.compositeRegimeLabel },
    portfolioRiskReference: { id: 'portfolio-risk', eventType: input.portfolioRisk?.eventType, status: input.portfolioRisk?.summary?.riskLevel ?? input.portfolioRisk?.riskLevel },
    drawdownProtectionReference: { id: 'drawdown-protection', eventType: input.drawdownProtection?.eventType, status: input.drawdownProtection?.protectionStatus },
    capitalAllocationReference: { id: 'capital-allocation', eventType: input.capitalAllocation?.eventType, status: input.capitalAllocation?.allocationStatus },
    strategyLifecycleReference: { id: 'strategy-lifecycle', eventType: input.strategyLifecycle?.eventType, status: input.strategyLifecycle?.lifecycleState ?? input.strategyLifecycle?.lifecycleStatus },
    strategyRegistryReference: { id: 'strategy-registry', eventType: input.strategyRegistry?.eventType, status: input.strategyRegistry?.registryStatus },
  }
  const missingRequired = [
    ['research-enhanced decision', contextRefs.researchEnhancedDecisionReference.eventType],
    ['market regime', contextRefs.marketRegimeReference.eventType],
    ['portfolio risk', contextRefs.portfolioRiskReference.eventType],
    ['drawdown protection', contextRefs.drawdownProtectionReference.eventType],
    ['capital allocation', contextRefs.capitalAllocationReference.eventType],
  ].filter(([, present]) => !present).map(([label]) => label)
  const decisions = []
  let duplicateSuppressed = 0

  for (const signal of signals.slice(0, 100)) {
    if (!isPermittedSignal(signal, allowWatchlist)) continue
    const suppressionKey = `${signal.symbol}:${signal.id}:${signal.signalStatus}`
    if (existingKeys.has(suppressionKey)) {
      duplicateSuppressed += 1
      continue
    }
    const unsafeMode = hasUnsafeMode(input) || hasUnsafeMode(signal)
    const missingContext = [...missingRequired]
    if (!signal.sourceEventReferences?.length) missingContext.push('source event reference')
    if (signal.duplicate === true || signal.routingStatus === 'duplicate') missingContext.push('duplicate signal context')
    if (signal.stale === true || signal.routingStatus === 'stale') missingContext.push('stale signal context')
    if (unsafeMode) missingContext.push('paper-mode invariant')
    const riskAdjustment = input.drawdownProtection?.protectionStatus === 'locked' ? -30 : input.drawdownProtection?.protectionStatus === 'caution' ? -10 : 0
    const allocationAdjustment = input.capitalAllocation?.allocationStatus === 'constrained' ? -20 : input.capitalAllocation?.allocationStatus === 'caution' ? -5 : 0
    const confidence = clampScore(signal.signalConfidence + riskAdjustment + allocationAdjustment)
    const decisionStatus = buildDecisionStatus({ signal, confidence, missingContext, unsafeMode })
    const alert = alertsBySignalId.get(signal.id)
    decisions.push(normalizeRealtimePaperDecision({
      tenantContext,
      id: `realtime-paper-decision-${signal.id}`,
      symbol: signal.symbol,
      assetType: signal.assetType,
      decisionStatus,
      decisionConfidence: confidence,
      decisionAction: signal.signalAction,
      decisionRationale: decisionStatus === 'rejected'
        ? `Real-time paper decision rejected: ${missingContext[0] ?? 'signal did not meet paper decision requirements'}.`
        : `${signal.symbol} ${signal.signalStatus} signal converted into ${decisionStatus} paper decision context with AI, research, regime, risk, allocation, and strategy references.`,
      sourceScannerReference: signal.scannerCandidateReference,
      sourceSignalReference: { id: signal.id, eventType: signal.eventType ?? 'signal.realtime.evaluated', status: signal.signalStatus },
      sourceAlertReference: alert ? { id: alert.id, eventType: alert.eventType ?? 'alerts.realtime.created', status: alert.lifecycle } : null,
      ...contextRefs,
      rejectionReasons: missingContext,
      duplicateSuppressionKey: suppressionKey,
      timestamp,
    }, decisions.length))
  }

  const realtimePaperDecisionSummary = {
    total: decisions.length,
    approved: decisions.filter((item) => item.decisionStatus === 'approved').length,
    caution: decisions.filter((item) => item.decisionStatus === 'caution').length,
    rejected: decisions.filter((item) => item.decisionStatus === 'rejected').length,
    watchlist: decisions.filter((item) => item.decisionStatus === 'watchlist').length,
    duplicateSuppressed,
    requiredContextPresent: missingRequired.length === 0,
  }
  const decisionEvaluationStatus = realtimePaperDecisionSummary.approved > 0 ? 'approved'
    : realtimePaperDecisionSummary.caution > 0 ? 'caution'
      : realtimePaperDecisionSummary.watchlist > 0 ? 'watchlist'
        : 'rejected'
  const result = {
    eventType: PAPER_DECISION_REALTIME_EVALUATED_EVENT,
    timestamp,
    realtimePaperDecisions: decisions,
    realtimePaperDecisionSummary,
    decisionEvaluationStatus,
    paperModeInvariant: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    automaticTrading: false,
    summary: `Real-time paper decision coordinator ${decisionEvaluationStatus}: ${realtimePaperDecisionSummary.approved} approved, ${realtimePaperDecisionSummary.caution} caution, ${realtimePaperDecisionSummary.watchlist} watchlist, and ${realtimePaperDecisionSummary.rejected} rejected decisions.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(PAPER_DECISION_REALTIME_EVALUATED_EVENT, result)
  return result
}
