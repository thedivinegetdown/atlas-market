export function scoreSignal(quote) {
  const momentum = Number(quote?.momentum ?? 0)
  const trend = Number(quote?.trend ?? 0)
  const volatility = Number(quote?.volatility ?? 0)
  const volume = Number(quote?.volumeScore ?? 0)
  const riskAdjusted = Number(quote?.riskAdjusted ?? 0)

  const composite = Number(
    (momentum * 0.35) + (trend * 0.25) + (volume * 0.15) + (riskAdjusted * 0.25) + 20
  ) * 2.8

  return {
    momentum,
    trend,
    volatility,
    volume,
    riskAdjusted,
    composite,
  }
}
