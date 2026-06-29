export function createTradeStatsEngine() {
  return {
    summarize(trades = []) {
      return {
        tradeCount: trades.length,
        averageWin: trades.length === 0 ? 0 : trades.reduce((sum, trade) => sum + Number(trade.pnl ?? 0), 0) / trades.length,
      }
    },
  }
}
