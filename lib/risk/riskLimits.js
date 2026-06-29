export const DEFAULT_RISK_LIMITS = Object.freeze({
  maxPositionSize: 1000,
  maxDailyLoss: 250,
  maxOrderNotional: 500,
  maxPortfolioExposure: 0.35,
  symbolConcentrationLimit: 0.2,
  staleMarketDataSeconds: 90,
})

export function createRiskLimits(overrides = {}) {
  return {
    ...DEFAULT_RISK_LIMITS,
    ...overrides,
  }
}
