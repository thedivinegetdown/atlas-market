export function calculateRealizedPnl(trades = []) {
  return trades.reduce((total, trade) => {
    if (trade.side === 'SELL') {
      return total + (Number(trade.quantity) * (Number(trade.fillPrice) - Number(trade.avgCost ?? 0)))
    }
    return total
  }, 0)
}

export function calculateUnrealizedPnl(positions = [], quoteMap = {}) {
  return positions.reduce((total, position) => {
    const quote = quoteMap[position.symbol] ?? {}
    const currentPrice = Number(quote.price ?? position.averageCost ?? 0)
    const positionValue = position.quantity * currentPrice
    const costBasis = position.quantity * position.averageCost
    return total + (positionValue - costBasis)
  }, 0)
}
