import { createRiskLimits } from './riskLimits.js'

export function createPositionSizingEngine({ limits = createRiskLimits() } = {}) {
  return {
    sizeOrder({ accountBalance = 0, riskPerTrade = 0.01, price = 0, stopDistance = 0 } = {}) {
      if (!accountBalance || !price || !stopDistance) {
        return 0
      }

      const riskAmount = accountBalance * riskPerTrade
      const riskQuantity = Math.floor(riskAmount / stopDistance)
      const notionalQuantity = Math.floor(limits.maxOrderNotional / price)
      const shareCap = Math.floor(limits.maxPositionSize)
      return Math.max(0, Math.min(riskQuantity, notionalQuantity, shareCap))
    },
  }
}
