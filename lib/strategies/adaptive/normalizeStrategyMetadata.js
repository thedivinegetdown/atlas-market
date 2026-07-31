function normalizeList(values = []) {
  return [...new Set((Array.isArray(values) ? values : [values]).map((value) => String(value ?? '').trim()).filter(Boolean))]
}

export function normalizeStrategyMetadata(strategy = {}) {
  const strategyId = String(strategy.strategyId ?? strategy.id ?? '').trim().toLowerCase()
  const lifecycleState = String(strategy.lifecycleState ?? strategy.status ?? 'unknown').trim().toLowerCase()
  const status = String(strategy.status ?? lifecycleState).trim().toLowerCase()
  return {
    strategyId,
    strategyName: String(strategy.strategyName ?? strategy.name ?? strategyId ?? 'Unknown Strategy').trim() || 'Unknown Strategy',
    status,
    lifecycleState,
    validationStatus: String(strategy.validationStatus ?? 'unknown').trim().toLowerCase(),
    activationEligibilityStatus: String(strategy.activationEligibilityStatus ?? 'unknown').trim().toLowerCase(),
    requiredIndicators: normalizeList(strategy.requiredIndicators),
    blockingPrerequisites: normalizeList(strategy.blockingPrerequisites),
    paperTrading: true,
  }
}
