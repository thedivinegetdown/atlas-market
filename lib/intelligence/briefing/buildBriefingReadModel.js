import { BRIEFING_STATUSES, DAILY_BRIEFING_VERSION } from './dailyBriefingTypes.js'

function statusFor(model, priorities) {
  if (priorities.some((item) => item.level === 'CRITICAL')) return BRIEFING_STATUSES.BLOCKED
  const missingCore = model.market.status === 'INSUFFICIENT_DATA' || model.strategies.status === 'INSUFFICIENT_DATA' || !model.portfolioRisk.available
  if (missingCore) return BRIEFING_STATUSES.INSUFFICIENT_DATA
  if (model.market.marketData?.dataStatus && model.market.marketData.dataStatus !== 'LIVE') return BRIEFING_STATUSES.CAUTION
  if (model.market.status !== 'COMPLETE' || model.market.freshness !== 'FRESH' || priorities.some((item) => ['HIGH', 'MEDIUM'].includes(item.level))) return BRIEFING_STATUSES.CAUTION
  return BRIEFING_STATUSES.READY
}

export function buildBriefingReadModel(model, priorities) {
  const warnings = []
  if (model.opportunities.length === 0) warnings.push('No bounded reviewed Trade Quality results are available.')
  if (!model.portfolioRisk.available) warnings.push('Portfolio risk evidence is unavailable.')
  if (model.portfolioRisk.concentration == null) warnings.push('Portfolio concentration is not available in the current summary contract.')
  if (model.operations.providerStatus === 'UNKNOWN') warnings.push('Provider health is unknown.')
  if (model.market.marketData?.dataStatus && model.market.marketData.dataStatus !== 'LIVE') warnings.push(`Market data status is ${model.market.marketData.dataStatus}; all derived guidance is qualified.`)
  return { version: DAILY_BRIEFING_VERSION, status: statusFor(model, priorities), asOf: model.asOf, market: model.market, strategies: model.strategies, opportunities: model.opportunities, portfolioRisk: model.portfolioRisk, operations: model.operations, priorities, coverage: { market: model.market.status !== 'INSUFFICIENT_DATA', strategies: model.strategies.status !== 'INSUFFICIENT_DATA', opportunities: model.opportunities.length > 0, portfolioRisk: model.portfolioRisk.available, operations: model.operations.status !== 'UNKNOWN' }, warnings, boundaries: { advisoryOnly: true, paperTradingOnly: true, automaticActions: false } }
}
