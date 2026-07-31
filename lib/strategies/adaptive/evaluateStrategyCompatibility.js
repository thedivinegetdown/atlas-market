function categoryResult(value, rules, label) {
  if (!value || value === 'UNKNOWN') return { status: 'unknown', reason: `${label} regime is unknown` }
  if (rules.enabled.includes(value)) return { status: 'compatible', reason: `${label} regime ${value} is compatible` }
  if (rules.conditional.includes(value)) return { status: 'conditional', reason: `${label} regime ${value} requires caution` }
  return { status: 'incompatible', reason: `${label} regime ${value} is incompatible` }
}

export function evaluateStrategyCompatibility(classification = {}, rules) {
  return [
    categoryResult(classification.trendRegime, rules.trend, 'Trend'),
    categoryResult(classification.volatilityRegime, rules.volatility, 'Volatility'),
    categoryResult(classification.riskRegime, rules.risk, 'Risk'),
  ]
}
