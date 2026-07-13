import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const SIGNAL_REALTIME_EVALUATED_EVENT = 'signal.realtime.evaluated'
export const REALTIME_SIGNAL_STATUSES = Object.freeze(['qualified', 'watchlist', 'rejected'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Number(value ?? 0)))
}

function safeStatus(status) {
  return REALTIME_SIGNAL_STATUSES.includes(status) ? status : 'watchlist'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, eventType: reference.eventType ?? reference.type ?? null }
}

export function normalizeRealtimeSignalEvaluation(input = {}, index = 0) {
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  const timestamp = input.createdAt ?? input.timestamp ?? getNowIso()
  const confidence = clampScore(input.signalConfidence ?? input.confidence)
  const status = safeStatus(input.signalStatus ?? input.status ?? (confidence >= 75 ? 'qualified' : confidence >= 50 ? 'watchlist' : 'rejected'))
  return {
    id: String(input.id ?? `realtime-signal-${input.symbol ?? 'SPY'}-${Date.parse(timestamp) || Date.now()}-${index + 1}`).slice(0, 220),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    symbol: String(input.symbol ?? 'SPY').toUpperCase().slice(0, 24),
    assetType: String(input.assetType ?? 'etf').toLowerCase().slice(0, 40),
    signalStatus: status,
    signalConfidence: confidence,
    signalAction: String(input.signalAction ?? input.action ?? 'WATCH').toUpperCase().slice(0, 40),
    signalRationale: String(input.signalRationale ?? input.rationale ?? 'Real-time scanner candidate reviewed for paper decision context.').slice(0, 600),
    strategyRuleEvaluationReference: normalizeReference(input.strategyRuleEvaluationReference),
    strategySignalComposerReference: normalizeReference(input.strategySignalComposerReference),
    researchSignalScoreReference: normalizeReference(input.researchSignalScoreReference),
    multiTimeframeContextReference: normalizeReference(input.multiTimeframeContextReference),
    marketRegimeReference: normalizeReference(input.marketRegimeReference),
    portfolioRiskReference: normalizeReference(input.portfolioRiskReference),
    sourceEventReferences: (input.sourceEventReferences ?? []).slice(0, 12).map(normalizeReference),
    scannerCandidateReference: normalizeReference(input.scannerCandidateReference),
    createdAt: timestamp,
    updatedAt: input.updatedAt ?? timestamp,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    automaticTrading: false,
  }
}

export function createRealtimeSignalEvaluationRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const signal = normalizeRealtimeSignalEvaluation(input)
      if (!database?.connected) return { ok: true, disabled: true, signal }
      const result = await database.query(
        `INSERT INTO atlas_realtime_signal_evaluations
          (id, organization_id, team_workspace_id, signal_status, symbol, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET signal_status = EXCLUDED.signal_status, symbol = EXCLUDED.symbol, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [signal.id, signal.tenantScope.organizationId, signal.tenantScope.teamWorkspaceId, signal.signalStatus, signal.symbol, signal],
      )
      return { ok: true, signal: normalizeRealtimeSignalEvaluation(result.rows?.[0]?.payload ?? signal) }
    },
    async list({ tenantContext = {}, signalStatus, symbol, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (signalStatus) {
        params.push(safeStatus(signalStatus))
        clauses.push(`signal_status = $${params.length}`)
      }
      if (symbol) {
        params.push(String(symbol).toUpperCase())
        clauses.push(`symbol = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_realtime_signal_evaluations
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeRealtimeSignalEvaluation(row.payload))
    },
  }
}

export function evaluateRealtimeSignals(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? getNowIso()
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.realtimeSignalEvaluations ?? input.signals ?? []
  const candidates = input.realtimeScanner?.scannerCandidates ?? input.scannerCandidates ?? []
  const researchScore = input.researchSignalScore ?? {}
  const marketRegime = input.marketRegimeClassification ?? input.marketRegime ?? {}
  const portfolioRisk = input.portfolioRisk ?? {}
  const ruleEvaluation = input.strategyRuleEvaluation ?? {}
  const signalComposer = input.strategySignalComposition ?? {}
  const multiTimeframe = input.multiTimeframeResearchContext ?? {}
  const generated = candidates.slice(0, 100).map((candidate, index) => {
    const scannerScore = Number(candidate.signal?.score ?? 50)
    const researchAlignment = researchScore.decisionBias === 'avoid' ? -20 : researchScore.decisionBias === 'bullish' ? 10 : researchScore.decisionBias === 'bearish' ? -10 : 0
    const regimeAdjustment = marketRegime.riskRegime?.regime === 'risk-off' ? -15 : marketRegime.riskRegime?.regime === 'risk-on' ? 5 : 0
    const riskAdjustment = ['blocked', 'critical'].includes(portfolioRisk.summary?.riskLevel ?? portfolioRisk.riskLevel) ? -25 : 0
    const strategyAdjustment = ruleEvaluation.strategyEvaluationStatus === 'blocked' ? -20 : signalComposer.signalStatus === 'composed' ? 8 : 0
    const confidence = clampScore(scannerScore + researchAlignment + regimeAdjustment + riskAdjustment + strategyAdjustment)
    const status = confidence >= 75 ? 'qualified' : confidence >= 50 ? 'watchlist' : 'rejected'
    return normalizeRealtimeSignalEvaluation({
      tenantContext,
      id: `realtime-signal-${candidate.id}`,
      symbol: candidate.symbol,
      assetType: candidate.assetType,
      signalStatus: status,
      signalConfidence: confidence,
      signalAction: candidate.signal?.action ?? (status === 'rejected' ? 'REJECT' : 'WATCH'),
      signalRationale: `${candidate.scannerName} produced ${candidate.matchedCriteria.length} matching criteria; research, regime, strategy, and risk references were applied without trade execution.`,
      strategyRuleEvaluationReference: { id: 'strategy-rule-evaluation', eventType: ruleEvaluation.eventType },
      strategySignalComposerReference: { id: 'strategy-signal-composer', eventType: signalComposer.eventType },
      researchSignalScoreReference: { id: 'research-signal-score', eventType: researchScore.eventType },
      multiTimeframeContextReference: { id: 'multi-timeframe-research', eventType: multiTimeframe.eventType },
      marketRegimeReference: { id: 'market-regime', eventType: marketRegime.eventType },
      portfolioRiskReference: { id: 'portfolio-risk', eventType: portfolioRisk.eventType },
      scannerCandidateReference: { id: candidate.id, eventType: input.realtimeScanner?.eventType },
      sourceEventReferences: [candidate.sourceEventReference].filter(Boolean),
      timestamp,
    }, index)
  })
  const evaluations = (Array.isArray(supplied) && supplied.length ? supplied : generated).map((item, index) => normalizeRealtimeSignalEvaluation({ ...item, tenantContext }, index))
  const realtimeSignalSummary = {
    total: evaluations.length,
    qualified: evaluations.filter((item) => item.signalStatus === 'qualified').length,
    watchlist: evaluations.filter((item) => item.signalStatus === 'watchlist').length,
    rejected: evaluations.filter((item) => item.signalStatus === 'rejected').length,
    averageConfidence: evaluations.length ? Math.round(evaluations.reduce((sum, item) => sum + item.signalConfidence, 0) / evaluations.length) : 0,
  }
  const signalEvaluationStatus = realtimeSignalSummary.qualified > 0 ? 'qualified' : realtimeSignalSummary.watchlist > 0 ? 'watchlist' : 'rejected'
  const result = {
    eventType: SIGNAL_REALTIME_EVALUATED_EVENT,
    timestamp,
    realtimeSignalEvaluations: evaluations,
    realtimeSignalSummary,
    signalEvaluationStatus,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    automaticTrading: false,
    summary: `Real-time signal evaluation ${signalEvaluationStatus}: ${realtimeSignalSummary.qualified} qualified, ${realtimeSignalSummary.watchlist} watchlist, and ${realtimeSignalSummary.rejected} rejected signals.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(SIGNAL_REALTIME_EVALUATED_EVENT, result)
  return result
}
