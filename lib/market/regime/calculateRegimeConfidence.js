function categoryConfidence(result, minimumEvidence) {
  if (!result || result.evidenceCount < minimumEvidence || result.regime === 'UNKNOWN') return 0
  const evidenceCoverage = Math.min(1, result.evidenceCount / Math.max(minimumEvidence + 2, 3))
  const distance = result.score <= 100 && result.score >= 0 ? Math.abs(result.score - 50) : Math.abs(result.score)
  return Math.round(55 + evidenceCoverage * 25 + Math.min(20, distance * 0.3))
}

export function calculateRegimeConfidence({ trend, volatility, risk, missingInputs, invalidInputs, status, config }) {
  const scores = [
    categoryConfidence(trend, config.trend.minimumEvidence),
    categoryConfidence(volatility, config.volatility.minimumEvidence),
    categoryConfidence(risk, config.risk.minimumEvidence),
  ]
  const available = scores.filter((score) => score > 0)
  const base = available.length ? available.reduce((sum, score) => sum + score, 0) / available.length : 0
  const missingPenalty = Math.min(config.confidence.maximumMissingPenalty, missingInputs.length * config.confidence.missingInputPenalty)
  const invalidPenalty = invalidInputs.length * config.confidence.invalidInputPenalty
  let confidence = Math.max(0, Math.min(100, Math.round(base - missingPenalty - invalidPenalty)))
  if (status === 'PARTIAL') confidence = Math.min(confidence, config.confidence.partialStatusCap)
  if (status === 'INVALID_INPUT') confidence = Math.min(confidence, config.confidence.invalidStatusCap)
  if (status === 'INSUFFICIENT_DATA') confidence = Math.min(confidence, config.confidence.insufficientStatusCap)
  return confidence
}
