import { createPositionEngine } from './positionEngine.js'
import { calculateRealizedPnl, calculateUnrealizedPnl } from './pnlEngine.js'

export function createPortfolioEngine() {
  const positionEngine = createPositionEngine()

  return {
    buildState({ cash = 0, positions = {}, fills = [], quoteMap = {} } = {}) {
      const positionMap = fills.reduce((accumulator, fill) => {
        return positionEngine.applyFill(accumulator, fill)
      }, { ...positions })

      const openPositions = Object.values(positionMap).filter((position) => Number(position.quantity) > 0)
      const realizedPnl = calculateRealizedPnl(fills)
      const unrealizedPnl = calculateUnrealizedPnl(openPositions, quoteMap)
      const totalExposure = openPositions.reduce((total, position) => {
        return total + (Number(position.quantity) * Number(quoteMap[position.symbol]?.price ?? position.averageCost ?? 0))
      }, 0)
      const equity = Number(cash) + totalExposure + realizedPnl + unrealizedPnl
      const buyingPower = Math.max(0, Number(cash) - totalExposure)

      return {
        cash,
        equity,
        buyingPower,
        openPositions,
        realizedPnl,
        unrealizedPnl,
        totalExposure,
      }
    },
  }
}
