export const DEFAULT_REGIME_CONFIG = Object.freeze({
  trend: Object.freeze({ strongBullScore: 60, bullScore: 25, bearScore: -25, strongBearScore: -60, minimumEvidence: 2, strongMaSeparationPct: 2, slopePct: 0.5, strongSlopePct: 1, adxTrend: 20, adxStrongTrend: 30, relativeStrengthPct: 1 }),
  volatility: Object.freeze({ highScore: 70, lowScore: 30, minimumEvidence: 1, highAtrPct: 2.5, lowAtrPct: 0.75, highAtrPercentile: 70, lowAtrPercentile: 30, highVix: 25, lowVix: 15 }),
  risk: Object.freeze({ riskOnScore: 65, riskOffScore: 35, minimumEvidence: 1, positiveBreadthPct: 60, negativeBreadthPct: 40, strongBreadthPct: 70, weakBreadthPct: 30, highVix: 25, lowVix: 15, relativeStrengthPct: 1 }),
  confidence: Object.freeze({ missingInputPenalty: 4, invalidInputPenalty: 12, maximumMissingPenalty: 28, partialStatusCap: 78, invalidStatusCap: 45, insufficientStatusCap: 20 }),
})

export function createRegimeConfig(overrides = {}) {
  return {
    trend: { ...DEFAULT_REGIME_CONFIG.trend, ...overrides.trend },
    volatility: { ...DEFAULT_REGIME_CONFIG.volatility, ...overrides.volatility },
    risk: { ...DEFAULT_REGIME_CONFIG.risk, ...overrides.risk },
    confidence: { ...DEFAULT_REGIME_CONFIG.confidence, ...overrides.confidence },
  }
}
