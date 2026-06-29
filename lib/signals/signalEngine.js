import {
  calculateMomentum,
  calculateTrend,
  calculateVolatility,
  calculateVolumeScore,
  calculateRiskAdjustedScore,
} from './technicalIndicators.js'
import { scoreSignal } from './scoringEngine.js'
import { buildThesis, determineAction } from './strategyEngine.js'

export function createSignalEngine() {
  return {
    evaluateQuote(quote) {
      const momentum = calculateMomentum(quote)
      const trend = calculateTrend(quote)
      const volatility = calculateVolatility(quote)
      const volume = calculateVolumeScore(quote)
      const riskAdjusted = calculateRiskAdjustedScore(quote)
      const scored = scoreSignal({
        momentum,
        trend,
        volatility,
        volumeScore: volume,
        riskAdjusted,
      })

      const factors = []
      if (momentum > 0) factors.push('positive momentum')
      if (trend > 0) factors.push('upward trend')
      if (volatility > 20) factors.push('elevated volatility')
      if (volume > 4) factors.push('strong volume')

      const riskFlags = []
      if (volatility > 30) riskFlags.push('elevated-volatility')
      if (volume < 2) riskFlags.push('low-volume')
      if (scored.composite <= 40) riskFlags.push('weak-setup')

      const action = determineAction(scored.composite, riskFlags)
      const confidence = Math.min(95, Math.max(20, Math.round(Math.abs(scored.composite) + 25)))

      return {
        symbol: quote?.symbol ?? '',
        action,
        score: Number(scored.composite.toFixed(2)),
        confidence,
        thesis: buildThesis(action, factors.length > 0 ? factors : ['balanced conditions']),
        factors,
        riskFlags,
        updatedAt: new Date().toISOString(),
      }
    },
  }
}
