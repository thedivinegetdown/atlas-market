function clampScore(value) {
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue)) return 50
  return Math.max(0, Math.min(100, Math.round(numericValue)))
}

function numberValue(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

function createResult(score, label, reasons = [], warnings = []) {
  return {
    score: clampScore(score),
    label,
    reasons: reasons.filter(Boolean),
    warnings: warnings.filter(Boolean),
  }
}

export class TrendScorer {
  score({ quote = {}, signal = {} } = {}) {
    const direction = String(signal.trendDirection ?? signal.trend ?? '').toLowerCase()
    const changePercent = numberValue(quote.changePercent)
    const reasons = []
    const warnings = []
    let score = 50

    if (direction.includes('up') || changePercent > 1) {
      score += 24
      reasons.push('Trend structure is rising')
    } else if (direction.includes('down') || changePercent < -1) {
      score -= 24
      reasons.push('Trend structure is declining')
    } else {
      reasons.push('Trend structure is mixed')
    }

    if (numberValue(signal.bullScore) > numberValue(signal.bearScore)) {
      score += 8
      reasons.push('Bull score is stronger than bear score')
    }

    if (changePercent < -3) {
      warnings.push('Daily trend is sharply negative')
    }

    return createResult(score, score >= 65 ? 'bullish' : score <= 35 ? 'bearish' : 'mixed', reasons, warnings)
  }
}

export class MomentumScorer {
  score({ quote = {}, signal = {}, scannerMatches = [] } = {}) {
    const action = String(signal.action ?? '').toUpperCase()
    const momentum = numberValue(signal.momentum)
    const changePercent = numberValue(quote.changePercent)
    const reasons = []
    const warnings = []
    let score = 50 + (momentum * 3)

    if (action.includes('BUY')) {
      score += 18
      reasons.push('Signal engine favors upside participation')
    } else if (action.includes('SELL')) {
      score -= 18
      reasons.push('Signal engine favors downside or exit')
    }

    if (changePercent > 0) reasons.push('Price momentum is positive')
    if (scannerMatches.length > 0) {
      score += 7
      reasons.push('Scanner criteria match this symbol')
    }
    if (changePercent < -4) warnings.push('Momentum is deteriorating quickly')

    return createResult(score, score >= 65 ? 'positive' : score <= 35 ? 'negative' : 'balanced', reasons, warnings)
  }
}

export class RiskScorer {
  score({ risk = {} } = {}) {
    const checks = Array.isArray(risk.checks) ? risk.checks : []
    const passedChecks = checks.filter((check) => check.passed).length
    const passRate = checks.length > 0 ? passedChecks / checks.length : (risk.approved === false ? 0.2 : 0.75)
    const reasons = []
    const warnings = []
    let score = passRate * 100

    if (risk.approved === false) {
      score = Math.min(score, 25)
      warnings.push(risk.warning ?? risk.reason ?? 'Risk engine did not approve this trade')
    } else {
      reasons.push('Risk engine allows the candidate trade')
    }

    if (numberValue(risk.accountExposure) > 20) warnings.push('Account exposure is elevated')
    if (numberValue(risk.buyingPowerImpact) > 25) warnings.push('Buying power impact is elevated')

    return createResult(score, score >= 70 ? 'acceptable' : score <= 35 ? 'blocked' : 'constrained', reasons, warnings)
  }
}

export class VolatilityScorer {
  score({ quote = {} } = {}) {
    const price = Math.max(0.01, numberValue(quote.price, 1))
    const atrPct = quote.atr == null ? null : (numberValue(quote.atr) / price) * 100
    const volatility = quote.volatility == null ? Math.abs(numberValue(quote.changePercent)) : Math.abs(numberValue(quote.volatility))
    const effectiveVolatility = atrPct ?? volatility
    const reasons = []
    const warnings = []
    let score = 78 - (effectiveVolatility * 8)

    if (effectiveVolatility <= 2) reasons.push('Volatility is controlled')
    if (effectiveVolatility > 5) warnings.push('Volatility is elevated for new risk')
    if (effectiveVolatility > 8) warnings.push('Volatility is extreme')

    return createResult(score, score >= 65 ? 'controlled' : score <= 35 ? 'elevated' : 'active', reasons, warnings)
  }
}

export class LiquidityScorer {
  score({ quote = {}, assetProfile = {} } = {}) {
    const volume = numberValue(quote.volume)
    const reasons = []
    const warnings = []
    const score = volume >= 1000000
      ? 92
      : volume >= 250000
        ? 72
        : volume > 0
          ? 42
          : assetProfile.assetType === 'forex'
            ? 60
            : 35

    if (volume >= 1000000) {
      reasons.push('Volume supports institutional execution')
    } else if (volume >= 250000) {
      reasons.push('Volume is adequate')
    } else if (volume > 0) {
      warnings.push('Volume is thin')
    } else if (assetProfile.assetType === 'forex') {
      reasons.push('Liquidity will be provider-driven for this asset type')
    } else {
      warnings.push('Liquidity data is missing')
    }

    return createResult(score, score >= 70 ? 'liquid' : score <= 40 ? 'thin' : 'adequate', reasons, warnings)
  }
}

export class PortfolioExposureScorer {
  score({ portfolio = {}, positions = [], quote = {} } = {}) {
    const symbol = quote.symbol
    const accountValue = numberValue(portfolio.accountValue ?? portfolio.cash, 100000)
    const existingPosition = positions.find((position) => position.symbol === symbol)
    const positionWeight = numberValue(existingPosition?.weight)
    const portfolioRisk = numberValue(portfolio.openRisk)
    const exposure = numberValue(portfolio.exposure) * 100
    const reasons = []
    const warnings = []
    let score = 82

    if (positionWeight > 0) {
      score -= Math.min(35, positionWeight)
      reasons.push('Existing position is already represented in portfolio exposure')
    } else {
      reasons.push('No existing position concentration detected')
    }

    if (exposure > 50) {
      score -= 18
      warnings.push('Portfolio exposure is elevated')
    }

    if (accountValue > 0 && portfolioRisk / accountValue > 0.04) {
      score -= 15
      warnings.push('Open portfolio risk is elevated')
    }

    return createResult(score, score >= 70 ? 'clear' : score <= 40 ? 'crowded' : 'managed', reasons, warnings)
  }
}

export function createDecisionScorers() {
  return {
    trend: new TrendScorer(),
    momentum: new MomentumScorer(),
    risk: new RiskScorer(),
    volatility: new VolatilityScorer(),
    liquidity: new LiquidityScorer(),
    portfolioExposure: new PortfolioExposureScorer(),
  }
}
