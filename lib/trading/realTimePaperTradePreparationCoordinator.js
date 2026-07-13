import { eventBus as defaultEventBus } from '../core/eventBus.js'
import { recommendPositionSize } from '../../src/core/risk/positionSizingEngine.js'
import { evaluateTradeGuardrail } from '../../src/core/risk/tradeGuardrailEngine.js'

export const PAPER_TRADE_REALTIME_PREPARED_EVENT = 'paperTrade.realtime.prepared'
export const PAPER_TRADE_REALTIME_GUARDRAIL_EVALUATED_EVENT = 'paperTrade.realtime.guardrailEvaluated'
export const REALTIME_PREPARED_TRADE_STATUSES = Object.freeze(['ready', 'caution', 'blocked'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
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
    status: reference.status ?? reference.decisionStatus ?? reference.decision ?? reference.signalStatus ?? null,
  }
}

function numberValue(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

function safeSide(action) {
  const normalized = String(action ?? 'WATCH').toUpperCase()
  if (['SELL', 'BEARISH', 'SHORT'].includes(normalized)) return 'sell'
  if (['COVER'].includes(normalized)) return 'cover'
  return 'buy'
}

function hasUnsafeMode(input = {}) {
  return input.paperTrading === false || input.liveOrders === true || input.brokerExecution === true || input.accountMode === 'live' || input.executionMode === 'live'
}

function safeStatus(status) {
  return REALTIME_PREPARED_TRADE_STATUSES.includes(status) ? status : 'blocked'
}

function buildProposedTrade(decision = {}, input = {}) {
  const template = input.tradeTemplate ?? {}
  const price = numberValue(template.price ?? input.quote?.last ?? input.quote?.price ?? input.marketPrice ?? 100, 100)
  const stopDistance = Math.max(price * 0.02, 0.01)
  const side = template.side ?? safeSide(decision.decisionAction)
  const stopPrice = template.stopPrice ?? (side === 'buy' || side === 'cover' ? price - stopDistance : price + stopDistance)
  return {
    id: template.id ?? `paper-trade-${decision.id ?? decision.symbol}`,
    symbol: decision.symbol ?? template.symbol ?? 'SPY',
    assetType: decision.assetType ?? template.assetType ?? 'etf',
    side,
    orderType: String(template.orderType ?? 'market').toLowerCase(),
    quantity: Math.max(1, numberValue(template.quantity, 1)),
    price,
    stopPrice,
    timeInForce: template.timeInForce ?? 'DAY',
    paperTrading: true,
  }
}

function validationStatus({ decision, positionSizing, capitalAllocation, drawdownProtection, guardrailDecision, unsafeMode }) {
  const blockers = []
  const cautions = []
  if (unsafeMode) blockers.push('paper-mode invariant failed')
  if (!['approved', 'caution'].includes(decision.decisionStatus)) blockers.push('decision is not approved for preparation')
  if (!positionSizing?.eventType) blockers.push('position sizing reference is missing')
  if (positionSizing?.status === 'rejected') blockers.push('position sizing rejected proposed trade')
  if (!capitalAllocation?.eventType) blockers.push('capital allocation reference is missing')
  if (capitalAllocation?.allocationStatus === 'constrained') blockers.push('capital allocation is constrained')
  if (!drawdownProtection?.eventType) blockers.push('drawdown protection reference is missing')
  if (drawdownProtection?.protectionStatus === 'locked') blockers.push('drawdown protection is locked')
  if (!guardrailDecision?.eventType) blockers.push('trade guardrail reference is missing')
  if (guardrailDecision?.decision === 'rejected' || guardrailDecision?.approved === false) blockers.push('trade guardrail rejected proposed trade')
  if (decision.decisionStatus === 'caution') cautions.push('decision is caution')
  if (capitalAllocation?.allocationStatus === 'caution') cautions.push('capital allocation is caution')
  if (drawdownProtection?.protectionStatus === 'caution') cautions.push('drawdown protection is caution')
  return {
    status: blockers.length ? 'blocked' : cautions.length ? 'caution' : 'ready',
    blockers,
    cautions,
  }
}

export function normalizeRealtimePreparedTrade(input = {}, index = 0) {
  const timestamp = input.createdAt ?? input.timestamp ?? getNowIso()
  const status = safeStatus(input.preparationStatus ?? input.status)
  return {
    id: String(input.id ?? `realtime-prepared-trade-${input.symbol ?? 'SPY'}-${Date.parse(timestamp) || Date.now()}-${index + 1}`).slice(0, 220),
    tenantScope: normalizeTenantScope(input),
    symbol: String(input.symbol ?? input.proposedPaperTrade?.symbol ?? 'SPY').toUpperCase().slice(0, 24),
    assetType: String(input.assetType ?? input.proposedPaperTrade?.assetType ?? 'etf').toLowerCase().slice(0, 40),
    preparationStatus: status,
    proposedPaperTrade: { ...(input.proposedPaperTrade ?? {}), paperTrading: true },
    positionSizingReference: normalizeReference(input.positionSizingReference),
    capitalAllocationReference: normalizeReference(input.capitalAllocationReference),
    drawdownProtectionReference: normalizeReference(input.drawdownProtectionReference),
    tradeGuardrailReference: normalizeReference(input.tradeGuardrailReference),
    sourceDecisionReference: normalizeReference(input.sourceDecisionReference),
    buyingPowerValidation: input.buyingPowerValidation ?? { status: 'unknown' },
    cashValidation: input.cashValidation ?? { status: 'unknown' },
    portfolioHeatValidation: input.portfolioHeatValidation ?? { status: 'unknown' },
    guardrailEvaluation: input.guardrailEvaluation ?? null,
    preparationBlockers: (input.preparationBlockers ?? []).slice(0, 12).map(String),
    preparationCautions: (input.preparationCautions ?? []).slice(0, 12).map(String),
    duplicateSuppressionKey: String(input.duplicateSuppressionKey ?? `${input.symbol ?? 'SPY'}:${input.sourceDecisionReference?.id ?? input.id ?? 'decision'}`).slice(0, 260),
    createdAt: timestamp,
    updatedAt: input.updatedAt ?? timestamp,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    automaticTrading: false,
  }
}

export function createRealtimePreparedTradeRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const preparedTrade = normalizeRealtimePreparedTrade(input)
      if (!database?.connected) return { ok: true, disabled: true, preparedTrade }
      const result = await database.query(
        `INSERT INTO atlas_realtime_prepared_trades
          (id, organization_id, team_workspace_id, preparation_status, symbol, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET preparation_status = EXCLUDED.preparation_status, symbol = EXCLUDED.symbol, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [preparedTrade.id, preparedTrade.tenantScope.organizationId, preparedTrade.tenantScope.teamWorkspaceId, preparedTrade.preparationStatus, preparedTrade.symbol, preparedTrade],
      )
      return { ok: true, preparedTrade: normalizeRealtimePreparedTrade(result.rows?.[0]?.payload ?? preparedTrade) }
    },
    async list({ tenantContext = {}, preparationStatus, symbol, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (preparationStatus) {
        params.push(safeStatus(preparationStatus))
        clauses.push(`preparation_status = $${params.length}`)
      }
      if (symbol) {
        params.push(String(symbol).toUpperCase())
        clauses.push(`symbol = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_realtime_prepared_trades
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeRealtimePreparedTrade(row.payload))
    },
  }
}

export function prepareRealtimePaperTrades(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? getNowIso()
  const tenantContext = input.tenantContext ?? {}
  const portfolio = input.portfolio ?? {}
  const decisions = input.realtimePaperDecisions?.realtimePaperDecisions ?? input.decisions ?? []
  const existingKeys = new Set((input.existingPreparedTrades ?? []).map((trade) => trade.duplicateSuppressionKey))
  const preparedTrades = []
  const guardrailEvaluations = []
  let duplicateSuppressed = 0

  for (const decision of decisions.slice(0, 100)) {
    const suppressionKey = `${decision.symbol}:${decision.id}:${decision.decisionStatus}`
    if (existingKeys.has(suppressionKey)) {
      duplicateSuppressed += 1
      continue
    }
    const proposedTrade = buildProposedTrade(decision, input)
    const guardrailDecision = input.tradeGuardrail?.eventType
      ? input.tradeGuardrail
      : evaluateTradeGuardrail(portfolio, proposedTrade, { emitEvent: false, currentRisk: input.portfolioRisk, timestamp })
    const sizing = input.positionSizing?.eventType
      ? input.positionSizing
      : recommendPositionSize(portfolio, proposedTrade, {
        emitEvent: false,
        portfolioRisk: input.portfolioRisk,
        drawdownProtection: input.drawdownProtection,
        guardrailDecision,
        timestamp,
      })
    const validation = validationStatus({
      decision,
      positionSizing: sizing,
      capitalAllocation: input.capitalAllocation,
      drawdownProtection: input.drawdownProtection,
      guardrailDecision,
      unsafeMode: hasUnsafeMode(input) || hasUnsafeMode(decision),
    })
    const quantity = sizing?.status === 'recommended' && numberValue(sizing.suggestedQuantity) > 0
      ? sizing.suggestedQuantity
      : proposedTrade.quantity
    const normalizedTrade = { ...proposedTrade, quantity, paperTrading: true }
    const buyingPower = numberValue(input.portfolioRisk?.account?.buyingPower ?? input.capitalAllocation?.account?.buyingPower)
    const cash = numberValue(input.portfolioRisk?.account?.cash ?? input.capitalAllocation?.account?.cash)
    const requiredCapital = numberValue(guardrailDecision?.metrics?.marginRequirement ?? sizing?.metrics?.marginRequirement)
    const buyingPowerValidation = { status: requiredCapital <= buyingPower ? 'passed' : 'blocked', requiredCapital, buyingPower }
    const cashValidation = { status: requiredCapital <= cash || normalizedTrade.side !== 'buy' ? 'passed' : 'blocked', requiredCash: normalizedTrade.side === 'buy' ? requiredCapital : 0, cash }
    if (buyingPowerValidation.status === 'blocked') validation.blockers.push('buying power is insufficient')
    if (cashValidation.status === 'blocked') validation.blockers.push('cash is insufficient')
    const preparationStatus = validation.blockers.length ? 'blocked' : validation.status
    const guardrailEvent = {
      eventType: PAPER_TRADE_REALTIME_GUARDRAIL_EVALUATED_EVENT,
      timestamp,
      sourceDecisionReference: { id: decision.id, eventType: decision.eventType ?? 'paperDecision.realtime.evaluated', status: decision.decisionStatus },
      tradeGuardrailReference: normalizeReference(guardrailDecision),
      guardrailDecision: guardrailDecision?.decision ?? 'missing',
      guardrailApproved: guardrailDecision?.approved === true,
      preparationStatus,
      paperTrading: true,
      liveOrders: false,
      brokerExecution: false,
      automaticTrading: false,
    }
    guardrailEvaluations.push(guardrailEvent)
    preparedTrades.push(normalizeRealtimePreparedTrade({
      tenantContext,
      id: `realtime-prepared-trade-${decision.id}`,
      symbol: decision.symbol,
      assetType: decision.assetType,
      preparationStatus,
      proposedPaperTrade: normalizedTrade,
      positionSizingReference: { id: 'position-sizing', eventType: sizing?.eventType, status: sizing?.status },
      capitalAllocationReference: { id: 'capital-allocation', eventType: input.capitalAllocation?.eventType, status: input.capitalAllocation?.allocationStatus },
      drawdownProtectionReference: { id: 'drawdown-protection', eventType: input.drawdownProtection?.eventType, status: input.drawdownProtection?.protectionStatus },
      tradeGuardrailReference: { id: 'trade-guardrail', eventType: guardrailDecision?.eventType, status: guardrailDecision?.decision },
      sourceDecisionReference: { id: decision.id, eventType: decision.eventType ?? 'paperDecision.realtime.evaluated', status: decision.decisionStatus },
      buyingPowerValidation,
      cashValidation,
      portfolioHeatValidation: {
        status: guardrailDecision?.metrics?.portfolioHeatAfterTrade <= guardrailDecision?.metrics?.maxPortfolioHeatPct ? 'passed' : 'blocked',
        portfolioHeatAfterTrade: guardrailDecision?.metrics?.portfolioHeatAfterTrade ?? null,
        maxPortfolioHeatPct: guardrailDecision?.metrics?.maxPortfolioHeatPct ?? null,
      },
      guardrailEvaluation: guardrailEvent,
      preparationBlockers: validation.blockers,
      preparationCautions: validation.cautions,
      duplicateSuppressionKey: suppressionKey,
      timestamp,
    }, preparedTrades.length))
  }

  const realtimePreparedTradeSummary = {
    total: preparedTrades.length,
    ready: preparedTrades.filter((item) => item.preparationStatus === 'ready').length,
    caution: preparedTrades.filter((item) => item.preparationStatus === 'caution').length,
    blocked: preparedTrades.filter((item) => item.preparationStatus === 'blocked').length,
    duplicateSuppressed,
  }
  const preparationStatus = realtimePreparedTradeSummary.ready > 0 ? 'ready'
    : realtimePreparedTradeSummary.caution > 0 ? 'caution'
      : 'blocked'
  const result = {
    eventType: PAPER_TRADE_REALTIME_PREPARED_EVENT,
    timestamp,
    realtimePreparedTrades: preparedTrades,
    realtimeGuardrailEvaluations: guardrailEvaluations,
    realtimePreparedTradeSummary,
    preparationStatus,
    paperModeInvariant: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    automaticTrading: false,
    summary: `Real-time paper trade preparation ${preparationStatus}: ${realtimePreparedTradeSummary.ready} ready, ${realtimePreparedTradeSummary.caution} caution, and ${realtimePreparedTradeSummary.blocked} blocked trades.`,
  }
  if (emitEvent && eventBus?.emit) {
    eventBus.emit(PAPER_TRADE_REALTIME_PREPARED_EVENT, result)
    eventBus.emit(PAPER_TRADE_REALTIME_GUARDRAIL_EVALUATED_EVENT, guardrailEvaluations)
  }
  return result
}
