function priority(id, level, title, reason, source) { return { id, level, title, reason, source } }

export function rankBriefingPriorities(model, config) {
  const items = []
  if (model.market.status === 'INVALID_INPUT') items.push(priority('invalid-market-evidence', 'CRITICAL', 'Verify invalid market evidence', 'The market regime input is invalid.', 'market'))
  else if (model.market.freshness === 'STALE') items.push(priority('stale-market-evidence', 'CRITICAL', 'Verify stale market evidence', 'Critical regime evidence is stale.', 'market'))
  else if (model.market.status !== 'COMPLETE') items.push(priority('partial-market-evidence', 'MEDIUM', 'Review incomplete market evidence', `Market regime status is ${model.market.status}.`, 'market'))
  if (model.market.riskRegime === 'RISK_OFF') items.push(priority('risk-off-environment', 'HIGH', 'Review risk-off environment', 'The deterministic market risk regime is RISK OFF.', 'market'))
  for (const alert of model.operations.alerts) {
    if (alert.severity === 'CRITICAL') items.push(priority(`alert-${alert.id}`, 'CRITICAL', 'Review critical alert', alert.summary, 'alerts'))
    else if (alert.severity === 'HIGH') items.push(priority(`alert-${alert.id}`, 'HIGH', 'Review high-severity alert', alert.summary, 'alerts'))
    else if (alert.severity === 'CAUTION') items.push(priority(`alert-${alert.id}`, 'MEDIUM', 'Review caution alert', alert.summary, 'alerts'))
    else items.push(priority(`alert-${alert.id}`, 'LOW', 'Review informational alert', alert.summary, 'alerts'))
  }
  if (['DEGRADED', 'UNHEALTHY', 'BLOCKED'].includes(String(model.operations.providerStatus).toUpperCase())) items.push(priority('provider-degradation', 'HIGH', 'Investigate degraded provider', `Provider ${model.operations.provider} reports ${model.operations.providerStatus}.`, 'operations'))
  if (model.portfolioRisk.drawdown >= config.thresholds.severeDrawdownPct) items.push(priority('severe-drawdown', 'CRITICAL', 'Review severe portfolio drawdown', `Drawdown is ${model.portfolioRisk.drawdown}%.`, 'portfolio'))
  else if (model.portfolioRisk.drawdown >= config.thresholds.elevatedDrawdownPct) items.push(priority('elevated-drawdown', 'HIGH', 'Review elevated portfolio drawdown', `Drawdown is ${model.portfolioRisk.drawdown}%.`, 'portfolio'))
  if (model.portfolioRisk.concentration >= config.thresholds.concentrationPct) items.push(priority('portfolio-concentration', 'HIGH', 'Review elevated portfolio concentration', `Concentration is ${model.portfolioRisk.concentration}%.`, 'portfolio'))
  for (const opportunity of model.opportunities) {
    if (opportunity.status === 'COMPLETE' && opportunity.score >= config.thresholds.highOpportunityScore) items.push(priority(`opportunity-${opportunity.symbol}`, 'HIGH', 'Review high-quality opportunity', `${opportunity.symbol} has a ${opportunity.band} advisory quality result.`, 'opportunities'))
    else if (opportunity.score >= config.thresholds.moderateOpportunityScore) items.push(priority(`opportunity-${opportunity.symbol}`, 'MEDIUM', 'Review moderate opportunity', `${opportunity.symbol} requires human review.`, 'opportunities'))
  }
  if (model.strategies.conditional > 0) items.push(priority('conditional-strategies', 'MEDIUM', 'Review conditional strategy suitability', `${model.strategies.conditional} strategy result(s) are conditional.`, 'strategies'))
  if (items.length === 0) items.push(priority('healthy-summary', 'INFORMATIONAL', 'Review current briefing', 'No elevated deterministic review item is present.', 'briefing'))
  return items.sort((a, b) => config.priorityOrder[a.level] - config.priorityOrder[b.level] || a.id.localeCompare(b.id)).slice(0, config.priorityLimit)
}
