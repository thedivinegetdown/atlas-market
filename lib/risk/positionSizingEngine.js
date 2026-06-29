import { createRiskLimits } from './riskLimits.js'

export function createPositionSizingEngine({ limits = createRiskLimits() } = {}) {
  return {
    sizeOrder({ accountBalance = 0, riskPerTrade = 0.01, price = 0, stopDistance = 0 } = {}) {
      if (!accountBalance || !price || !stopDistance) {
        return 0
      }

      const riskAmount = accountBalance * riskPerTrade
      const positionSize = riskAmount / stopDistance
      return Math.min(positionSize, limits.maxPositionSize)
    },
  }
}
