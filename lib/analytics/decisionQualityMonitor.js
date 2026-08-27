import { reviewPaperPerformance } from './paperPerformanceReviewEngine.js'
import { buildPaperLearningEvidence } from './paperLearning/paperLearningEngine.js'
import { buildStrategyFamilyRegistry } from '../strategies/registry/index.js'

export const DECISION_QUALITY_MONITOR_VERSION = 'decision-quality-monitor-v1'

const number = (value) => Number.isFinite(Number(value)) ? Number(value) : null
const average = (values) => values.reduce((total, value) => total + value, 0) / values.length
const median = (values) => { const sorted = [...values].sort((left, right) => left - right); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2 }
const plannedLoss = (record = {}) => number(record.qualifiedTradePlan?.risk?.maximumPlannedLoss ?? record.tradePlan?.risk?.maximumPlannedLoss ?? record.orderPlan?.maximumPlannedLoss)
const completed = (record = {}) => record.paperTradingOnly !== false && (record.status === 'SIMULATED_FILLED' || record.executionStatus === 'simulated' || record.decisionGate?.execution === 'filled') && ['position_closed', 'position_reduced'].includes(record.accountingStatus ?? record.accountingUpdate?.status ?? record.accountingUpdateSnapshot?.status) && number(record.realizedPnl) != null
const maturityStrength = (status) => status === 'ESTABLISHED' ? 'STRONG' : ['DEVELOPING', 'EARLY'].includes(status) ? 'MODERATE' : 'WEAK'

function rNormalized(records) {
  const values = records.map((record) => ({ outcome: number(record.realizedPnl), risk: plannedLoss(record) })).filter((entry) => entry.outcome != null && entry.risk != null && entry.risk > 0).map((entry) => Number((entry.outcome / entry.risk).toFixed(4)))
  if (values.length !== records.length || values.length === 0) return { status: 'UNAVAILABLE', reason: 'Immutable entry-time planned maximum loss is unavailable for one or more completed outcomes.', validOutcomes: values.length, metrics: null }
  return { status: 'AVAILABLE', validOutcomes: values.length, metrics: { averageR: Number(average(values).toFixed(4)), medianR: Number(median(values).toFixed(4)), positiveRCount: values.filter((value) => value > 0).length, negativeRCount: values.filter((value) => value < 0).length, bestR: Math.max(...values), worstR: Math.min(...values) } }
}

function familyGrouping(records, registry, options) {
  const byFamily = new Map()
  for (const record of records) {
    const strategyId = record.strategyId
    const familyId = registry.strategies.find((entry) => entry.strategyId === strategyId)?.familyId
    if (!familyId) continue
    byFamily.set(familyId, [...(byFamily.get(familyId) ?? []), record])
  }
  return [...byFamily].sort(([left], [right]) => left.localeCompare(right)).map(([familyId, rows]) => {
    const review = reviewPaperPerformance(rows, options)
    return { familyId, sampleSize: review.sample.completedTrades, sampleMaturity: review.sample.status, performance: review.performance }
  })
}

export function buildDecisionQualityMonitor({ outcomes = [], performanceReview = null, registry = buildStrategyFamilyRegistry(), generatedAt = new Date().toISOString() } = {}, options = {}) {
  const review = performanceReview ?? reviewPaperPerformance(outcomes, { ...options, asOf: generatedAt })
  const completedOutcomes = outcomes.filter(completed)
  const learning = buildPaperLearningEvidence(review)
  const fingerprints = [...new Set(completedOutcomes.map((record) => record.qualifiedTradePlan?.integrity?.strategyFingerprint ?? record.strategyFingerprint ?? null).filter(Boolean))]
  const policyFingerprints = [...new Set(completedOutcomes.map((record) => record.qualifiedTradePlan?.integrity?.policyFingerprint ?? record.policyFingerprint ?? null).filter(Boolean))]
  const experimentIds = [...new Set(completedOutcomes.map((record) => record.experimentId ?? record.forwardObservation?.experimentId ?? null).filter(Boolean))]
  const compatibilityStatus = fingerprints.length > 1 || policyFingerprints.length > 1 ? 'INCOMPATIBLE_HISTORY' : (fingerprints.length || policyFingerprints.length ? 'COMPATIBLE' : 'UNAVAILABLE')
  const performance = review.performance ?? {}
  return Object.freeze({
    version: DECISION_QUALITY_MONITOR_VERSION,
    generatedAt,
    status: review.sample?.status ?? 'INSUFFICIENT_SAMPLE',
    overall: { completedOutcomes: review.sample?.completedTrades ?? 0, wins: review.sample?.wins ?? 0, losses: review.sample?.losses ?? 0, winRate: performance.winRate ?? 0, averageWin: performance.averageWin ?? 0, averageLoss: performance.averageLoss ?? 0, expectancy: performance.expectancyPerTrade ?? 0, grossPnL: performance.grossProfit ?? 0, netPnL: performance.netRealizedPnl ?? 0, profitFactor: performance.profitFactor ?? 0, largestWin: performance.largestWin ?? 0, largestLoss: performance.largestLoss ?? 0, maxDrawdown: performance.maximumDrawdownPct ?? 0, recoveryFactor: performance.recoveryFactor ?? 0 },
    rNormalized: rNormalized(completedOutcomes),
    groupings: { byStrategyId: review.strategies ?? [], byStrategyFamily: familyGrouping(completedOutcomes, registry, options), byExperimentId: experimentIds.map((experimentId) => ({ experimentId, compatibilityStatus: experimentIds.length === 1 ? 'COMPATIBLE' : 'SEPARATE_COHORT' })), byRegime: { trend: review.trendRegimes ?? [], volatility: review.volatilityRegimes ?? [], risk: review.riskRegimes ?? [] }, byTqBand: (review.qualityBands ?? []).map((group) => ({ ...group, evidenceStrength: maturityStrength(group.status) })), byDecisionStatus: review.evaluationStatuses ?? [], byPolicyFingerprint: policyFingerprints.map((fingerprint) => ({ policyFingerprint: fingerprint, compatibilityStatus: policyFingerprints.length === 1 ? 'COMPATIBLE' : 'INCOMPATIBLE_HISTORY' })) },
    tqCalibration: { status: learning.qualityCalibration?.status ?? 'INSUFFICIENT_DATA', groups: learning.qualityCalibration?.groups ?? [], descriptiveOnly: true },
    recentTrend: review.recentTrend === 'DETERIORATING' ? 'DEGRADING' : review.recentTrend ?? 'INSUFFICIENT_SAMPLE',
    compatibility: { status: compatibilityStatus, strategyFingerprints: fingerprints, policyFingerprints, reason: compatibilityStatus === 'INCOMPATIBLE_HISTORY' ? 'Outcomes with incompatible immutable fingerprints are not treated as a compatible evidence set.' : null },
    evidenceSeparation: { generalPaperHistory: true, edge2ForwardEvidence: review.forwardObservation ?? null, edge2Status: review.forwardObservation?.status ?? 'UNAVAILABLE' },
    boundaries: { readOnly: true, paperTradingOnly: true, automaticOptimization: false, automaticStrategyChanges: false, automaticExecution: false, empiricalConfidence: 'UNAVAILABLE' },
  })
}