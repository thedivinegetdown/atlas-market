export const QUALIFIED_TRADE_PLAN_VERSION = 'qualified-trade-plan-v1'
export const QUALIFIED_TRADE_PLAN_STATUSES = Object.freeze(['QUALIFIED', 'WATCH', 'REJECTED', 'NO_TRADE', 'INSUFFICIENT_DATA', 'STALE'])

const number = (value) => Number.isFinite(Number(value)) ? Number(value) : null
const unique = (values) => [...new Set(values.filter(Boolean).map((value) => String(value)))]
const planSide = (value) => ({ buy: 'long', sell: 'short', short: 'short', cover: 'long', long: 'long' }[String(value ?? '').toLowerCase()] ?? 'unknown')
const positive = (value) => number(value) != null && number(value) > 0

function tradeStructure(orderContext = {}) {
  const entry = number(orderContext.price ?? orderContext.referencePrice ?? orderContext.entryPrice)
  const stop = number(orderContext.stopPrice ?? orderContext.stopReference)
  const target = number(orderContext.targetPrice ?? orderContext.targetReference)
  const side = planSide(orderContext.side)
  const validRisk = positive(entry) && positive(stop) && entry !== stop && side !== 'unknown'
  const riskPerUnit = validRisk ? Math.abs(entry - stop) : null
  const rewardPerUnit = validRisk && positive(target)
    ? side === 'short' ? entry - target : target - entry
    : null
  return {
    side,
    entry,
    entryZone: entry == null ? null : { low: entry, high: entry },
    stop,
    target,
    riskPerUnit,
    rewardPerUnit: rewardPerUnit != null && rewardPerUnit > 0 ? rewardPerUnit : null,
    rMultiple: riskPerUnit && rewardPerUnit && rewardPerUnit > 0 ? Number((rewardPerUnit / riskPerUnit).toFixed(2)) : null,
  }
}

function allowedQuantity(sizing = {}, riskGate = {}, orderContext = {}) {
  const proposed = number(orderContext.quantity ?? sizing.proposedQuantity)
  const permitted = number(sizing.allowedQuantity ?? sizing.suggestedQuantity ?? sizing.quantity ?? riskGate.adjustedQuantity ?? proposed)
  return { proposedQuantity: proposed, allowedQuantity: permitted != null && permitted > 0 ? permitted : 0 }
}

function decisionStatus({ evaluation = {}, tradeQuality = {}, strategySuitability = {}, regime = {}, riskGate = {}, quantity }) {
  const quality = evaluation.tradeQuality ?? tradeQuality
  const freshnessValues = [evaluation.freshness, tradeQuality.freshness, regime.freshness].map((value) => String(value ?? '').toUpperCase())
  const marketStatus = String(regime.classification?.status ?? evaluation.regime?.status ?? '').toUpperCase()
  const strategy = strategySuitability.decision ?? evaluation.strategySuitability?.decision ?? evaluation.breakoutSignal?.suitabilityStatus
  const blockers = unique([...(tradeQuality.blockingReasons ?? []), ...(quality.blockingReasons ?? []), ...(evaluation.blockers ?? []), ...(riskGate.blockers ?? []), riskGate.approved === false ? riskGate.reason : null])
  const missing = unique([...(tradeQuality.missingInputs ?? []), ...(quality.missingInputs ?? []), ...(evaluation.missingEvidence ?? [])])
  if (freshnessValues.includes('STALE') || marketStatus === 'STALE') return 'STALE'
  if (missing.length || quality.score == null || !String(evaluation.status ?? '').trim()) return 'INSUFFICIENT_DATA'
  if (blockers.length || strategy === 'DISABLED' || evaluation.status === 'REJECTED' || riskGate.approved === false) return 'REJECTED'
  if (evaluation.noActionableSetup === true || tradeQuality.noActionableSetup === true || quantity.allowedQuantity === 0) return 'NO_TRADE'
  if (strategy === 'CONDITIONAL' || strategy === 'UNKNOWN' || evaluation.status === 'WATCH') return 'WATCH'
  if ((evaluation.status === 'APPROVED_FOR_PAPER_REVIEW' || evaluation.breakoutSignal?.suitabilityStatus === 'ENABLED') && strategy === 'ENABLED' && marketStatus === 'COMPLETE') return 'QUALIFIED'
  return 'NO_TRADE'
}

export function composeQualifiedTradePlan({ candidate = {}, tradeQuality = {}, regime = {}, strategySuitability = {}, evaluation = {}, riskGate = {}, sizing = {}, strategyVersion = null, policyFingerprint = null, strategyFingerprint = null } = {}, options = {}) {
  const orderContext = evaluation.orderContext ?? candidate.orderContext ?? tradeQuality.orderContext ?? {}
  const structure = tradeStructure(orderContext)
  const quantity = allowedQuantity(sizing, riskGate, orderContext)
  const status = decisionStatus({ evaluation, tradeQuality, strategySuitability, regime, riskGate, structure, quantity })
  const planQuantity = quantity.allowedQuantity
  const maximumPlannedLoss = structure.riskPerUnit != null ? Number((structure.riskPerUnit * planQuantity).toFixed(2)) : null
  const potentialTargetGain = structure.rewardPerUnit != null ? Number((structure.rewardPerUnit * planQuantity).toFixed(2)) : null
  const suitability = strategySuitability.strategies?.find((item) => item.strategyId === (candidate.strategyId ?? tradeQuality.strategyId ?? evaluation.strategyId)) ?? evaluation.strategySuitability ?? {}
  const quality = evaluation.tradeQuality ?? tradeQuality
  const supportingReasons = unique([...(quality.reasons ?? []), ...(evaluation.reasons ?? []), ...(suitability.reasons ?? [])])
  const cautionReasons = unique([...(quality.blockingReasons ?? []), ...(quality.missingInputs ?? []), ...(evaluation.blockers ?? []), ...(evaluation.missingEvidence ?? []), ...(suitability.blockingReasons ?? []), riskGate.approved === false ? riskGate.reason : null])
  const strategyId = candidate.strategyId ?? tradeQuality.strategyId ?? evaluation.strategyId ?? null
  const breakout = evaluation.breakoutSignal ?? candidate.breakoutSignal ?? null
  const generatedAt = options.generatedAt ?? evaluation.evaluatedAt ?? tradeQuality.asOf ?? regime.asOf ?? new Date().toISOString()
  const freshness = [evaluation.freshness, tradeQuality.freshness, regime.freshness].map((value) => String(value ?? '').toUpperCase()).includes('STALE')
    ? 'STALE'
    : evaluation.freshness ?? tradeQuality.freshness ?? regime.freshness ?? 'UNKNOWN'
  return Object.freeze({
    version: QUALIFIED_TRADE_PLAN_VERSION,
    planId: `qualified-plan-${evaluation.evidenceFingerprint ?? tradeQuality.evidenceFingerprint ?? candidate.opportunityId ?? `${strategyId ?? 'unknown'}-${candidate.symbol ?? tradeQuality.symbol ?? evaluation.symbol ?? 'unknown'}`}`,
    symbol: candidate.symbol ?? tradeQuality.symbol ?? evaluation.symbol ?? null,
    side: structure.side,
    strategyId,
    strategyVersion,
    strategyFamily: strategyId === 'breakout-momentum-v1' ? 'breakout-momentum' : strategyId === 'index-pullback-v1' ? 'trend-pullback' : null,
    generatedAt,
    timeframe: candidate.timeframe ?? regime.timeframe ?? null,
    horizon: candidate.horizon ?? null,
    market: { provenance: evaluation.marketData ?? tradeQuality.marketData ?? regime.marketData ?? null, freshness },
    regime: evaluation.regime ?? { trendRegime: regime.classification?.trendRegime ?? 'UNKNOWN', volatilityRegime: regime.classification?.volatilityRegime ?? 'UNKNOWN', riskRegime: regime.classification?.riskRegime ?? 'UNKNOWN', confidence: regime.classification?.confidence ?? 0, status: regime.classification?.status ?? 'INSUFFICIENT_DATA' },
    quality: { score: evaluation.tradeQuality?.score ?? tradeQuality.score ?? null, band: evaluation.tradeQuality?.band ?? tradeQuality.band ?? 'UNKNOWN', confidence: evaluation.tradeQuality?.confidence ?? tradeQuality.confidence ?? 0, coverage: tradeQuality.evidenceCoverage ?? null },
    strategy: { suitability: suitability.decision ?? 'UNKNOWN', confidence: suitability.confidence ?? null, reasons: unique(suitability.reasons ?? []), blockingReasons: unique(suitability.blockingReasons ?? []) },
    structure: { entry: structure.entry, entryZone: structure.entryZone, stop: structure.stop, invalidation: structure.stop == null ? null : `Invalidated at ${structure.stop}`, target: structure.target, rMultiple: structure.rMultiple },
    breakout: breakout ? { level: breakout.prior20High ?? null, percent: breakout.breakoutPercent ?? null, currentPrice: breakout.currentPrice ?? structure.entry, sma20: breakout.SMA20 ?? null, sma50: breakout.SMA50 ?? null, sma200: breakout.SMA200 ?? null, adx14: breakout.ADX14 ?? null, rsi14: breakout.RSI14 ?? null, relativeVolume: breakout.relativeVolume ?? null, relativeStrength: breakout.relativeStrength ?? null, marketParticipation: breakout.marketParticipation ?? null, sectorAlignment: breakout.sectorAlignment ?? null, evidenceFreshness: breakout.evidenceFreshness ?? freshness } : null,
    risk: { proposedQuantity: quantity.proposedQuantity, allowedQuantity: quantity.allowedQuantity, orderNotional: structure.entry == null ? null : Number((structure.entry * planQuantity).toFixed(2)), maximumPlannedLoss, potentialTargetGain, gateStatus: riskGate.approved === false || evaluation.riskSafety?.status === 'BLOCKED' ? 'BLOCKED' : evaluation.riskSafety?.status ?? (riskGate.approved === true ? 'APPROVED' : 'NOT_EVALUATED'), rejectionReasons: unique([...(riskGate.blockers ?? []), riskGate.approved === false ? riskGate.reason : null, ...(evaluation.blockers ?? [])]) },
    decision: { status, supportingReasons, cautionReasons },
    empiricalEvidence: { status: 'UNAVAILABLE', reason: 'Empirical forward evidence is not derived before INTEL.6.' },
    integrity: { strategyFingerprint: strategyFingerprint ?? breakout?.strategyFingerprint ?? null, policyFingerprint, experimentId: evaluation.experimentId ?? candidate.experimentId ?? null, evidenceFingerprint: evaluation.evidenceFingerprint ?? tradeQuality.evidenceFingerprint ?? null, sourceReferences: unique([candidate.opportunityId, evaluation.evaluationId]), engineVersions: evaluation.engineVersions ?? { tradeQuality: tradeQuality.engineVersion ?? null, regime: regime.engineVersion ?? null, strategySuitability: strategySuitability.engineVersion ?? null } },
    executable: false,
    boundaries: { readOnly: true, paperTradingOnly: true, humanDecisionRequired: true, automaticExecution: false, liveTrading: false, aiOverride: false, potentialTargetGainIsNotExpectedOrGuaranteedProfit: true },
  })
}