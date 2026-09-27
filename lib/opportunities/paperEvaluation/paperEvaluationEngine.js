import { createHash } from 'node:crypto'
import { DEFAULT_PAPER_EVALUATION_CONFIG } from './paperEvaluationConfig.js'
import {
  compactCurrentMarketEvidence,
  createCurrentMarketEvidenceBundle,
  validateCurrentMarketEvidenceBundle,
} from '../../market/currentMarketEvidenceContract.js'

export const PAPER_EVALUATION_VERSION = 'paper-evaluation-v1'
export const PAPER_EVALUATION_STATUSES = Object.freeze(['APPROVED_FOR_PAPER_REVIEW', 'WATCH', 'REJECTED', 'INSUFFICIENT_DATA', 'STALE', 'ERROR'])

function fingerprint(candidate, regime, suitability, currentMarketEvidence) {
  return createHash('sha256').update(JSON.stringify([candidate.opportunityId, candidate.strategyId, candidate.evidenceFingerprint ?? null, regime.engineVersion, regime.asOf, candidate.engineVersion, candidate.asOf, suitability?.decision, currentMarketEvidence?.fingerprint ?? null])).digest('hex')
}
function suitabilityFor(candidate, selection) { return selection?.strategies?.find((item) => item.strategyId === candidate.strategyId) ?? null }

function provenanceReason(reason) {
  return `Current-market provenance rejected: ${reason.replaceAll('_', ' ')}`
}

export function evaluatePaperCandidates({ candidates = [], regime = {}, strategySuitability = {}, portfolioRisk = {}, existingEvaluations = [], currentMarketEvidence = null } = {}, options = {}) {
  const config = options.config ?? DEFAULT_PAPER_EVALUATION_CONFIG
  const evaluatedAt = options.now ?? new Date().toISOString()
  const existing = new Map(existingEvaluations.map((item) => [item.evidenceFingerprint, item]))
  return candidates.slice(0, config.candidateLimit).map((candidate) => {
    const strategy = suitabilityFor(candidate, strategySuitability)
    const candidateEvidence = compactCurrentMarketEvidence({
      quote: { symbol: candidate.symbol, price: candidate.orderContext?.price },
      provenance: candidate.marketData,
    })
    const regimeEvidence = compactCurrentMarketEvidence({
      quote: { symbol: currentMarketEvidence?.symbol ?? regime.symbol, price: currentMarketEvidence?.price },
      provenance: regime.marketData,
    })
    const evidenceBundle = createCurrentMarketEvidenceBundle({ candidate: candidateEvidence, regime: regimeEvidence })
    const provenance = validateCurrentMarketEvidenceBundle(evidenceBundle, { now: evaluatedAt, maxAgeMs: config.currentMarketMaxAgeMs })
    const evidenceFingerprint = fingerprint(candidate, regime, strategy, evidenceBundle)
    if (provenance.valid && existing.has(evidenceFingerprint)) return { ...existing.get(evidenceFingerprint), reused: true }
    const blockers = [...(candidate.blockers ?? [])]
    const missingEvidence = [...(candidate.missingInputs ?? [])]
    const drawdown = Number(portfolioRisk.maxDrawdown)
    if (!candidate.symbol || !candidate.strategyId || candidate.strategyId === 'strategy-unknown') missingEvidence.push('candidateContext')
    if (!strategy) missingEvidence.push('strategySuitability')
    if (strategy?.decision === 'DISABLED') blockers.push('Strategy suitability is disabled')
    if (strategy?.blockingReasons?.length) blockers.push(...strategy.blockingReasons)
    if (Number.isFinite(drawdown) && drawdown >= config.severeDrawdownPct) blockers.push('Portfolio drawdown protection is blocking review approval')
    if ((candidate.blockers ?? []).some((reason) => /liquidity/i.test(reason))) blockers.push('Liquidity safety gate is blocking review approval')
    if (!provenance.valid) missingEvidence.push(...provenance.reasons)
    const provenanceStale = provenance.reasons.some((reason) => /stale|future|precedes/.test(reason))
    const stale = candidate.freshness === 'STALE' || regime.freshness === 'STALE' || provenanceStale
    let status = 'WATCH'
    if (stale) status = 'STALE'
    else if (missingEvidence.length || candidate.score == null || !Number.isFinite(Number(candidate.score))) status = 'INSUFFICIENT_DATA'
    else if (blockers.length) status = 'REJECTED'
    else if (candidate.score >= config.approvedScore && strategy?.decision === 'ENABLED' && regime.classification?.status === 'COMPLETE') status = 'APPROVED_FOR_PAPER_REVIEW'
    else if (candidate.score < config.watchScore || strategy?.decision === 'DISABLED') status = 'REJECTED'
    const reasons = [`Trade Quality is ${candidate.score ?? 'unavailable'} ${candidate.band ?? 'UNKNOWN'}`, strategy ? `Strategy suitability is ${strategy.decision}` : 'Strategy suitability is unavailable', ...provenance.reasons.map(provenanceReason)]
    if (Number.isFinite(drawdown) && drawdown >= config.elevatedDrawdownPct) reasons.push(`Portfolio drawdown is ${drawdown}%`)
    return {
      evaluationId: `paper-evaluation-${evidenceFingerprint.slice(0, 24)}`, candidateId: candidate.opportunityId, symbol: candidate.symbol, strategyId: candidate.strategyId,
      status, tradeQuality: { score: candidate.score, band: candidate.band, confidence: candidate.confidence, status: candidate.qualityStatus, engineVersion: candidate.engineVersion },
      regime: { trendRegime: regime.classification?.trendRegime ?? 'UNKNOWN', volatilityRegime: regime.classification?.volatilityRegime ?? 'UNKNOWN', riskRegime: regime.classification?.riskRegime ?? 'UNKNOWN', status: regime.classification?.status ?? 'INSUFFICIENT_DATA', confidence: regime.classification?.confidence ?? 0, engineVersion: regime.engineVersion ?? 'unknown' },
      strategySuitability: strategy ? { decision: strategy.decision, confidence: strategy.confidence, engineVersion: strategySuitability.engineVersion ?? 'unknown' } : null,
      riskSafety: { status: blockers.length ? 'BLOCKED' : drawdown >= config.elevatedDrawdownPct ? 'CAUTION' : 'WITHIN_REVIEW_LIMITS', drawdown: Number.isFinite(drawdown) ? drawdown : null },
      reasons, blockers: [...new Set(blockers)], marketData: regime.marketData, currentMarketEvidence: evidenceBundle, currentMarketEvidenceFingerprint: evidenceBundle.fingerprint, missingEvidence: [...new Set(missingEvidence)], freshness: stale ? 'STALE' : candidate.freshness, evaluatedAt, evidenceFingerprint,
      engineVersions: { paperEvaluation: PAPER_EVALUATION_VERSION, tradeQuality: candidate.engineVersion, regime: regime.engineVersion, strategySuitability: strategySuitability.engineVersion },
      orderContext: candidate.orderContext ?? null,
      reused: false, paperTradingOnly: true, advisoryOnly: true, automaticExecution: false, humanReviewRequired: true,
    }
  }).sort((a, b) => a.candidateId.localeCompare(b.candidateId))
}
