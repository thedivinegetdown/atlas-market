function finite(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null }
function safeList(value) { return Array.isArray(value) ? value : [] }
function allowedText(value) {
  const text = String(value ?? '').trim()
  return /\b(buy|sell|enter trade|exit trade|guaranteed opportunity)\b/i.test(text) ? null : text
}

export function normalizeBriefingInputs(input = {}, config) {
  const regime = input.regime ?? {}
  const classification = regime.classification ?? {}
  const suitability = input.strategySuitability ?? {}
  const portfolio = input.portfolioRisk?.summary ?? input.portfolioRisk ?? null
  const alerts = safeList(input.alerts).filter((alert) => alert?.enabled !== false && !['closed', 'resolved', 'dismissed'].includes(String(alert?.lifecycle ?? alert?.status).toLowerCase()))
  const opportunities = safeList(input.opportunities).slice(0, config.opportunityLimit).map((item) => ({
    symbol: String(item?.symbol ?? 'UNKNOWN').toUpperCase(), score: finite(item?.score), band: item?.band ?? 'UNKNOWN', confidence: finite(item?.confidence) ?? 0,
    status: item?.status ?? 'INSUFFICIENT_DATA', freshness: item?.freshness ?? 'UNKNOWN', reasons: safeList(item?.reasons).map(allowedText).filter(Boolean).slice(0, 3), blockers: safeList(item?.blockingReasons).map(allowedText).filter(Boolean).slice(0, 3),
  }))
  return {
    asOf: regime.asOf ?? input.asOf ?? null,
    market: { trendRegime: classification.trendRegime ?? 'UNKNOWN', volatilityRegime: classification.volatilityRegime ?? 'UNKNOWN', riskRegime: classification.riskRegime ?? 'UNKNOWN', confidence: finite(classification.confidence) ?? 0, status: classification.status ?? 'INSUFFICIENT_DATA', freshness: regime.freshness ?? 'UNKNOWN' },
    strategies: { status: suitability.status ?? 'INSUFFICIENT_DATA', enabled: suitability.summary?.enabled ?? 0, conditional: suitability.summary?.conditional ?? 0, disabled: suitability.summary?.disabled ?? 0, unknown: suitability.summary?.unknown ?? 0, averageConfidence: suitability.strategies?.length ? Math.round(suitability.strategies.reduce((sum, item) => sum + (finite(item.confidence) ?? 0), 0) / suitability.strategies.length) : 0, items: safeList(suitability.strategies).map((item) => ({ strategyId: item.strategyId, strategyName: allowedText(item.strategyName) ?? 'Strategy', decision: item.decision, confidence: finite(item.confidence) ?? 0 })) },
    opportunities,
    portfolioRisk: portfolio ? { available: true, accountValue: finite(portfolio.accountValue), openRisk: finite(portfolio.openRisk), drawdown: finite(portfolio.maxDrawdown), concentration: finite(portfolio.concentration), riskTier: portfolio.riskTier ?? 'UNKNOWN', warnings: safeList(portfolio.warnings).map(allowedText).filter(Boolean) } : { available: false, accountValue: null, openRisk: null, drawdown: null, concentration: null, riskTier: 'UNKNOWN', warnings: [] },
    operations: { status: input.operations?.status ?? 'UNKNOWN', provider: input.operations?.provider ?? 'unknown', providerStatus: input.operations?.providerStatus ?? 'UNKNOWN', openAlerts: alerts.length, criticalAlerts: alerts.filter((alert) => String(alert.severity).toLowerCase() === 'critical').length, alerts: alerts.map((alert) => ({ id: alert.id, severity: String(alert.severity ?? 'informational').toUpperCase(), summary: allowedText(alert.message ?? alert.name ?? alert.type ?? 'Alert requires review') ?? 'Alert requires review' })) },
  }
}
