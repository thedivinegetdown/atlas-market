import { eventBus as defaultEventBus } from '../../../lib/core/eventBus.js'

export const AI_DECISION_ORCHESTRATED_EVENT = 'ai.decision.orchestrated'

function numberValue(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

function round(value, decimals = 2) {
  return Number(numberValue(value).toFixed(decimals))
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, numberValue(value)))
}

function normalizeSymbol(symbol) {
  return String(symbol ?? '').trim().toUpperCase()
}

function normalizeDecisionInput(input = {}) {
  const proposedTrade = input.proposedTrade
    ?? input.positionSizing?.proposedTrade
    ?? input.guardrailDecision?.proposedTrade
    ?? {}
  const symbol = normalizeSymbol(proposedTrade.symbol ?? input.symbol)
  const assetType = String(proposedTrade.assetType ?? input.assetType ?? 'equity').trim().toLowerCase()

  return {
    symbol,
    assetType,
    proposedTrade: {
      ...proposedTrade,
      symbol,
      assetType,
      paperTrading: proposedTrade.paperTrading !== false,
    },
    scannerSignals: Array.isArray(input.scannerSignals) ? input.scannerSignals : [],
    signal: input.signal ?? null,
    portfolioRisk: input.portfolioRisk ?? null,
    drawdownProtection: input.drawdownProtection ?? null,
    positionSizing: input.positionSizing ?? null,
    capitalAllocation: input.capitalAllocation ?? null,
    guardrailDecision: input.guardrailDecision ?? null,
    performanceSnapshot: input.performanceSnapshot ?? null,
    riskAdjustedPerformance: input.riskAdjustedPerformance ?? null,
  }
}

function scoreSignalQuality({ scannerSignals, signal, proposedTrade }) {
  const scoredSignals = scannerSignals
    .filter((item) => !proposedTrade.symbol || normalizeSymbol(item.symbol) === proposedTrade.symbol)
    .map((item) => ({
      source: item.source ?? item.scannerName ?? 'scanner',
      direction: String(item.direction ?? item.signal ?? item.type ?? 'neutral').toLowerCase(),
      score: clamp(item.score ?? item.confidence ?? item.strength ?? 50),
      confidence: clamp(item.confidence ?? item.score ?? 50),
    }))
  const directSignal = signal
    ? [{
        source: signal.source ?? 'signal',
        direction: String(signal.direction ?? signal.overallSignal ?? 'neutral').toLowerCase(),
        score: clamp(signal.score ?? signal.confidence ?? signal.strength ?? 50),
        confidence: clamp(signal.confidence ?? signal.score ?? 50),
      }]
    : []
  const combined = [...scoredSignals, ...directSignal]

  if (combined.length === 0) {
    return {
      score: 50,
      label: 'neutral',
      signals: [],
      summary: 'No scanner or signal confirmation supplied',
    }
  }

  const averageScore = combined.reduce((sum, item) => sum + item.score, 0) / combined.length
  const averageConfidence = combined.reduce((sum, item) => sum + item.confidence, 0) / combined.length
  const bullishCount = combined.filter((item) => ['bullish', 'buy', 'strong_buy', 'long'].includes(item.direction)).length
  const bearishCount = combined.filter((item) => ['bearish', 'sell', 'strong_sell', 'short'].includes(item.direction)).length
  const directionalAdjustment = (bullishCount - bearishCount) * 5
  const score = clamp(((averageScore * 0.65) + (averageConfidence * 0.35)) + directionalAdjustment)

  return {
    score: round(score),
    label: score >= 70 ? 'strong' : score >= 58 ? 'constructive' : score >= 45 ? 'mixed' : 'weak',
    signals: combined,
    summary: `${combined.length} signal input${combined.length === 1 ? '' : 's'} evaluated`,
  }
}

function summarizeRiskApproval({ portfolioRisk, guardrailDecision }) {
  const guardrailApproved = guardrailDecision?.decision === 'approved' || guardrailDecision?.approved === true
  const riskLevel = portfolioRisk?.summary?.riskLevel ?? 'unknown'
  const riskScore = numberValue(portfolioRisk?.summary?.riskScore, 50)
  const approvalScore = guardrailApproved ? Math.max(0, 100 - riskScore) : 0

  return {
    approved: guardrailApproved,
    guardrailDecision: guardrailDecision?.decision ?? 'not_evaluated',
    riskLevel,
    riskScore: round(riskScore),
    approvalScore: round(approvalScore),
    reason: guardrailDecision?.reason ?? 'No guardrail decision supplied',
  }
}

function summarizePositionSizing(positionSizing) {
  const recommended = positionSizing?.status === 'recommended'

  return {
    approved: recommended,
    status: positionSizing?.status ?? 'not_evaluated',
    suggestedQuantity: recommended ? numberValue(positionSizing.suggestedQuantity) : 0,
    quantityTerm: positionSizing?.quantityTerm ?? 'units',
    riskPct: numberValue(positionSizing?.metrics?.riskPct),
    dollarRisk: numberValue(positionSizing?.metrics?.dollarRisk),
    reason: positionSizing?.reason ?? 'No position sizing recommendation supplied',
  }
}

function summarizeCapitalAllocation(capitalAllocation) {
  const allocationStatus = capitalAllocation?.allocationStatus ?? 'unknown'

  return {
    approved: allocationStatus === 'balanced' || allocationStatus === 'caution',
    allocationStatus,
    availableCapital: numberValue(capitalAllocation?.capital?.availableCapital),
    remainingRiskBudget: numberValue(capitalAllocation?.capital?.remainingRiskBudget),
    recommendations: capitalAllocation?.recommendations ?? [],
  }
}

function summarizeDrawdownProtection(drawdownProtection) {
  const protectionStatus = drawdownProtection?.protectionStatus ?? 'unknown'

  return {
    approved: protectionStatus === 'clear' || protectionStatus === 'caution',
    protectionStatus,
    recommendedAction: drawdownProtection?.recommendedAction ?? 'unknown',
    currentDrawdown: numberValue(drawdownProtection?.currentDrawdown),
    warnings: drawdownProtection?.warnings ?? [],
  }
}

function scorePerformanceContext({ performanceSnapshot, riskAdjustedPerformance }) {
  const profitFactor = numberValue(performanceSnapshot?.metrics?.profitFactor)
  const expectancy = numberValue(performanceSnapshot?.metrics?.expectancy)
  const grade = riskAdjustedPerformance?.metrics?.riskAdjustedGrade ?? 'C'
  const gradeScore = { A: 90, B: 78, C: 65, D: 42, F: 20 }[grade] ?? 60
  const performanceScore = clamp(
    (Math.min(2, profitFactor) / 2) * 45
      + (expectancy > 0 ? 25 : 0)
      + (gradeScore * 0.3),
  )

  return {
    score: round(performanceScore),
    profitFactor,
    expectancy,
    riskAdjustedGrade: grade,
  }
}

function decide({ signalQuality, riskApproval, positionSizing, capitalAllocation, drawdownProtection, performanceContext, proposedTrade }) {
  const blockers = []
  const cautions = []

  if (proposedTrade.paperTrading === false) blockers.push('Only paper trading decisions are supported')
  if (!riskApproval.approved) blockers.push(riskApproval.reason)
  if (!positionSizing.approved) blockers.push(positionSizing.reason)
  if (!capitalAllocation.approved) blockers.push('Capital allocation is constrained')
  if (!drawdownProtection.approved) blockers.push('Drawdown protection is locked')

  if (signalQuality.score < 45) cautions.push('Signal quality is weak')
  if (riskApproval.riskLevel === 'elevated' || riskApproval.riskLevel === 'high') cautions.push(`Portfolio risk is ${riskApproval.riskLevel}`)
  if (capitalAllocation.allocationStatus === 'caution') cautions.push('Capital allocation requires caution')
  if (drawdownProtection.protectionStatus === 'caution') cautions.push('Drawdown protection recommends reduced risk')
  if (performanceContext.score < 45) cautions.push('Performance context is weak')

  if (blockers.length > 0) {
    return { finalDecision: 'reject', blockers, cautions }
  }

  if (signalQuality.score < 50) {
    return { finalDecision: 'watchlist', blockers, cautions }
  }

  if (cautions.length > 0) {
    return { finalDecision: 'caution', blockers, cautions }
  }

  return { finalDecision: 'approve', blockers, cautions }
}

function calculateConfidence({ signalQuality, riskApproval, positionSizing, capitalAllocation, drawdownProtection, performanceContext, finalDecision }) {
  const riskScore = riskApproval.approved ? riskApproval.approvalScore : 15
  const sizingScore = positionSizing.approved ? 85 : 15
  const allocationScore = capitalAllocation.allocationStatus === 'balanced'
    ? 85
    : capitalAllocation.allocationStatus === 'caution'
      ? 65
      : 20
  const drawdownScore = drawdownProtection.protectionStatus === 'clear'
    ? 85
    : drawdownProtection.protectionStatus === 'caution'
      ? 65
      : 15
  const decisionPenalty = finalDecision === 'reject' ? -10 : finalDecision === 'watchlist' ? -5 : 0

  return round(clamp(
    (signalQuality.score * 0.25)
      + (riskScore * 0.2)
      + (sizingScore * 0.15)
      + (allocationScore * 0.15)
      + (drawdownScore * 0.15)
      + (performanceContext.score * 0.1)
      + decisionPenalty,
  ))
}

function buildRationale({ finalDecision, signalQuality, positionSizing, capitalAllocation, drawdownProtection, performanceContext, blockers, cautions }) {
  if (finalDecision === 'reject') {
    return `Reject paper trade: ${blockers[0] ?? 'required approval failed'}.`
  }
  if (finalDecision === 'watchlist') {
    return `Watchlist only: ${signalQuality.summary} but signal quality is not strong enough for paper execution.`
  }
  if (finalDecision === 'caution') {
    return `Proceed with caution: ${cautions[0] ?? 'one or more upstream controls require review'}.`
  }

  return `Approve paper decision: signal quality is ${signalQuality.label}, guardrails passed, sizing recommends ${round(positionSizing.suggestedQuantity, 4)} ${positionSizing.quantityTerm}, allocation is ${capitalAllocation.allocationStatus}, drawdown is ${drawdownProtection.protectionStatus}, and performance grade is ${performanceContext.riskAdjustedGrade}.`
}

export function orchestrateAIDecision(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? new Date().toISOString()
  const normalized = normalizeDecisionInput(input)
  const signalQuality = scoreSignalQuality(normalized)
  const riskApproval = summarizeRiskApproval(normalized)
  const positionSizing = summarizePositionSizing(normalized.positionSizing)
  const capitalAllocation = summarizeCapitalAllocation(normalized.capitalAllocation)
  const drawdownProtection = summarizeDrawdownProtection(normalized.drawdownProtection)
  const performanceContext = scorePerformanceContext(normalized)
  const decision = decide({
    signalQuality,
    riskApproval,
    positionSizing,
    capitalAllocation,
    drawdownProtection,
    performanceContext,
    proposedTrade: normalized.proposedTrade,
  })
  const confidenceScore = calculateConfidence({
    signalQuality,
    riskApproval,
    positionSizing,
    capitalAllocation,
    drawdownProtection,
    performanceContext,
    finalDecision: decision.finalDecision,
  })

  const result = {
    eventType: AI_DECISION_ORCHESTRATED_EVENT,
    paperTrading: true,
    timestamp,
    status: 'orchestrated',
    decisionInput: {
      symbol: normalized.symbol,
      assetType: normalized.assetType,
      proposedTrade: normalized.proposedTrade,
    },
    signalQuality,
    riskApprovalSummary: riskApproval,
    positionSizingSummary: positionSizing,
    capitalAllocationSummary: capitalAllocation,
    drawdownProtectionSummary: drawdownProtection,
    performanceContext,
    finalDecision: decision.finalDecision,
    confidenceScore,
    rationale: buildRationale({
      finalDecision: decision.finalDecision,
      signalQuality,
      riskApproval,
      positionSizing,
      capitalAllocation,
      drawdownProtection,
      performanceContext,
      blockers: decision.blockers,
      cautions: decision.cautions,
    }),
    blockers: decision.blockers,
    cautions: decision.cautions,
    references: {
      portfolioRiskEvent: normalized.portfolioRisk?.eventType ?? null,
      drawdownProtectionEvent: normalized.drawdownProtection?.eventType ?? null,
      positionSizingEvent: normalized.positionSizing?.eventType ?? null,
      capitalAllocationEvent: normalized.capitalAllocation?.eventType ?? null,
      guardrailEvent: normalized.guardrailDecision?.eventType ?? null,
      performanceEvent: normalized.performanceSnapshot?.eventType ?? null,
      riskAdjustedPerformanceEvent: normalized.riskAdjustedPerformance?.eventType ?? null,
    },
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(AI_DECISION_ORCHESTRATED_EVENT, result)
  }

  return result
}

export function createAIDecisionOrchestrator(options = {}) {
  return {
    orchestrate(input, orchestrationOptions = {}) {
      return orchestrateAIDecision(input, { ...options, ...orchestrationOptions })
    },
  }
}
