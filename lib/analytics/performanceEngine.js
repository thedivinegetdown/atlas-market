export function createPerformanceEngine() {
  return {
    summarize(journalRows = []) {
      const trades = journalRows.filter((row) => row?.pnl !== undefined)
      const winningTrades = trades.filter((row) => Number(row.pnl) > 0)
      const losingTrades = trades.filter((row) => Number(row.pnl) < 0)
      const winRate = trades.length === 0 ? 0 : winningTrades.length / trades.length
      const averageWin = winningTrades.length === 0 ? 0 : winningTrades.reduce((sum, row) => sum + Number(row.pnl), 0) / winningTrades.length
      const averageLoss = losingTrades.length === 0 ? 0 : Math.abs(losingTrades.reduce((sum, row) => sum + Number(row.pnl), 0) / losingTrades.length)
      const grossProfit = winningTrades.reduce((sum, row) => sum + Math.max(0, Number(row.pnl)), 0)
      const grossLoss = Math.abs(losingTrades.reduce((sum, row) => sum + Math.min(0, Number(row.pnl)), 0))
      const profitFactor = grossLoss === 0 ? (grossProfit > 0 ? Infinity : 0) : grossProfit / grossLoss

      return {
        tradeCount: trades.length,
        winRate,
        averageWin,
        averageLoss,
        profitFactor,
        realizedPnl: trades.reduce((sum, row) => sum + Number(row.pnl), 0),
      }
    },
  }
}
