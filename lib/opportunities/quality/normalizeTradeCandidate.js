import { normalizeOpportunityContract } from '../../ai/opportunityAnalysisEngine.js'

function finite(value) {
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  return Number.isFinite(parsed) ? parsed : null
}

export function normalizeTradeCandidate(input = {}) {
  const candidate = normalizeOpportunityContract(input)
  const suppliedAsOf = input.asOf ?? input.timestamp
  const metrics = candidate.deterministicMetrics ?? {}
  return {
    ...candidate,
    asOf: suppliedAsOf && !Number.isNaN(Date.parse(suppliedAsOf)) ? String(suppliedAsOf) : null,
    direction: String(candidate.direction ?? 'neutral').toLowerCase(),
    evidence: {
      trendScore: finite(metrics.trendScore),
      momentumScore: finite(metrics.momentumScore ?? metrics.momentum),
      relativeStrength: finite(metrics.relativeStrength),
      relativeVolume: finite(metrics.relativeVolume),
      atrPercentile: finite(metrics.atrPercentile),
      spreadPct: finite(candidate.liquiditySummary?.spreadPct),
      rewardRiskRatio: finite(candidate.riskSummary?.rewardRiskRatio ?? candidate.riskSummary?.rewardRatio),
    },
  }
}
