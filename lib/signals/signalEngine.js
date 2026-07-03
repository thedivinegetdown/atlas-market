import {
  calculateMomentum,
  calculateTrend,
  calculateVolatility,
  calculateVolumeScore,
  calculateRiskAdjustedScore,
} from './technicalIndicators.js'
import { scoreSignal } from './scoringEngine.js'
import { buildThesis, determineAction } from './strategyEngine.js'

function getTrendDirection(trend) {
  if (trend > 0.5) return 'Up'
  if (trend < -0.5) return 'Down'
  return 'Flat'
}

function getBreakoutStatus(quote, momentum, volume) {
  const price = Number(quote?.price ?? 0)
  const high = Number(quote?.high ?? 0)

  if (price > 0 && high > 0 && price >= high * 0.995 && momentum > 0 && volume >= 1) {
    return 'Breakout'
  }

  if (momentum < 0) {
    return 'Failed'
  }

  return 'Contained'
}

function getMeanReversionStatus(quote, momentum) {
  const price = Number(quote?.price ?? 0)
  const previousClose = Number(quote?.previousClose ?? 0)
  const distanceFromClose = previousClose > 0 ? ((price - previousClose) / previousClose) * 100 : 0

  if (Math.abs(distanceFromClose) >= 2 && Math.sign(distanceFromClose) !== Math.sign(momentum)) {
    return 'Reverting'
  }

  if (Math.abs(distanceFromClose) >= 2) {
    return 'Extended'
  }

  return 'Balanced'
}

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
      const bullScore = Math.max(0, Math.min(100, Math.round(scored.composite)))
      const bearScore = Math.max(0, Math.min(100, Math.round(100 - scored.composite)))
      const strength = Math.max(0, Math.min(100, Math.round(Math.abs(scored.composite - 50) * 2)))

      return {
        symbol: quote?.symbol ?? '',
        action,
        score: Number(scored.composite.toFixed(2)),
        confidence,
        trend: Number(trend.toFixed(2)),
        trendDirection: getTrendDirection(trend),
        momentum: Number(momentum.toFixed(2)),
        breakout: getBreakoutStatus(quote, momentum, volume),
        meanReversion: getMeanReversionStatus(quote, momentum),
        bullScore,
        bearScore,
        strength,
        thesis: buildThesis(action, factors.length > 0 ? factors : ['balanced conditions']),
        factors,
        riskFlags,
        updatedAt: new Date().toISOString(),
      }
    },
  }
}
