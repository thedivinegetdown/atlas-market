export function createPositionEngine() {
  return {
    applyFill(positionMap, fill) {
      const symbol = fill.symbol
      const existing = positionMap[symbol] ?? { symbol, quantity: 0, averageCost: 0 }
      const quantity = Number(fill.quantity ?? 0)
      const fillPrice = Number(fill.fillPrice ?? 0)

      if (fill.side === 'BUY') {
        const nextQuantity = existing.quantity + quantity
        const nextAverageCost = nextQuantity === 0
          ? 0
          : ((existing.quantity * existing.averageCost) + (quantity * fillPrice)) / nextQuantity

        return {
          ...positionMap,
          [symbol]: {
            symbol,
            quantity: nextQuantity,
            averageCost: nextAverageCost,
          },
        }
      }

      const nextQuantity = Math.max(0, existing.quantity - quantity)
      return {
        ...positionMap,
        [symbol]: {
          symbol,
          quantity: nextQuantity,
          averageCost: existing.averageCost,
        },
      }
    },
  }
}
