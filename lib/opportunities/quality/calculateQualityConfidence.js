export function calculateQualityConfidence({ coverage, freshness, regimeStatus, blockerCount }) {
  let confidence = coverage
  if (freshness === 'STALE') confidence -= 25
  if (freshness === 'UNKNOWN') confidence -= 10
  if (regimeStatus === 'PARTIAL') confidence -= 15
  if (regimeStatus === 'INVALID_INPUT' || regimeStatus === 'INSUFFICIENT_DATA') confidence -= 30
  confidence -= blockerCount * 10
  return Math.max(0, Math.min(100, Math.round(confidence)))
}
