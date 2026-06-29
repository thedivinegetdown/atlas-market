export function createEquityCurveEngine() {
  return {
    calculateMaxDrawdown(equitySeries = []) {
      if (equitySeries.length === 0) {
        return 0
      }

      let peak = equitySeries[0]
      let maxDrawdown = 0

      for (const value of equitySeries) {
        if (value > peak) {
          peak = value
        }

        const drawdown = peak === 0 ? 0 : ((peak - value) / peak) * 100
        if (drawdown > maxDrawdown) {
          maxDrawdown = drawdown
        }
      }

      return Number(maxDrawdown.toFixed(2))
    },
  }
}
