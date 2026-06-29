export function calculateMomentum(quote) {
  const changePercent = Number(quote?.changePercent ?? 0)
  const price = Number(quote?.price ?? 0)
  const previousClose = Number(quote?.previousClose ?? 0)
  const relativeMove = previousClose > 0 ? ((price - previousClose) / previousClose) * 100 : 0
  return Number((changePercent + relativeMove) / 2)
}

export function calculateTrend(quote) {
  const price = Number(quote?.price ?? 0)
  const open = Number(quote?.open ?? 0)
  const high = Number(quote?.high ?? 0)
  const low = Number(quote?.low ?? 0)

  if (price <= 0 || open <= 0) {
    return 0
  }

  const trendStrength = ((price - open) / open) * 100
  const rangeStrength = ((high - low) / Math.max(open, 1)) * 10
  return Number(trendStrength + rangeStrength)
}

export function calculateVolatility(quote) {
  const high = Number(quote?.high ?? 0)
  const low = Number(quote?.low ?? 0)
  const open = Number(quote?.open ?? 0)

  if (open <= 0) {
    return 0
  }

  const range = ((high - low) / open) * 100
  return Number(Math.min(range, 100))
}

export function calculateVolumeScore(quote) {
  const volume = Number(quote?.volume ?? 0)
  if (volume <= 0) {
    return 0
  }

  return Math.min(volume / 1000000, 10)
}

export function calculateRiskAdjustedScore(quote) {
  const momentum = calculateMomentum(quote)
  const volatility = calculateVolatility(quote)
  if (volatility <= 0) {
    return momentum
  }

  return Number(momentum / (1 + volatility / 100))
}
