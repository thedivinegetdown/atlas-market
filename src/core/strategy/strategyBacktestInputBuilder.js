import { normalizeAssetType } from '../../../lib/assets/index.js'
import { eventBus as defaultEventBus } from '../../../lib/core/eventBus.js'

export const STRATEGY_BACKTEST_INPUT_PREPARED_EVENT = 'strategy.backtestInput.prepared'

function normalizeText(value, fallback = '') {
  return String(value ?? fallback).trim() || fallback
}

function normalizeSymbol(value) {
  return normalizeText(value, 'MARKET').toUpperCase()
}

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function numberValue(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

function normalizeList(values = [], normalizer = (value) => value) {
  return [...new Set((Array.isArray(values) ? values : [values]).map(normalizer).filter(Boolean))]
}

function getSelectedStrategy(input = {}) {
  const requestedStrategyId = input.strategyId ?? input.selectedStrategyId
  const registry = input.strategyRegistry ?? {}
  if (requestedStrategyId && registry.activeStrategyLookup?.[requestedStrategyId]) {
    return registry.activeStrategyLookup[requestedStrategyId]
  }
  if (registry.registryRecord) return registry.registryRecord
  return input.strategyRegistryRecord ?? input.strategyLifecycle ?? {}
}

function buildSelectedStrategySnapshot(input = {}) {
  const selectedStrategy = getSelectedStrategy(input)
  return {
    strategyId: selectedStrategy.strategyId ?? selectedStrategy.id ?? input.strategyLifecycle?.strategyId ?? 'strategy-blueprint',
    strategyName: selectedStrategy.strategyName ?? input.strategyLifecycle?.strategyName ?? 'Untitled Strategy Blueprint',
    versionReference: selectedStrategy.versionReference ?? input.strategyLifecycle?.validationSnapshot?.version ?? '0.1.0',
    status: selectedStrategy.status ?? input.strategyLifecycle?.lifecycleState ?? 'draft',
    lifecycleState: selectedStrategy.lifecycleState ?? input.strategyLifecycle?.lifecycleState ?? 'draft',
    compatibleAssetClasses: normalizeList(selectedStrategy.compatibleAssetClasses ?? input.strategyLifecycle?.validationSnapshot?.compatibleAssetClasses ?? [], normalizeAssetType),
    timeframeReferences: normalizeList(selectedStrategy.timeframeReferences ?? input.strategyLifecycle?.validationSnapshot?.timeframeReferences ?? [], (value) => normalizeText(value).toLowerCase()),
    tags: normalizeList(selectedStrategy.tags ?? [], (value) => normalizeText(value).toLowerCase()),
    paperTrading: true,
  }
}

function buildSelectedAssetUniverse(input = {}, strategySnapshot) {
  const assets = input.assetUniverse ?? input.selectedAssetUniverse ?? [
    {
      symbol: input.symbol ?? input.strategyLifecycle?.symbol ?? input.marketDataAdapterHealth?.symbol ?? 'SPY',
      assetType: input.assetType ?? strategySnapshot.compatibleAssetClasses[0] ?? 'equity',
    },
  ]

  return normalizeList(assets.map((asset) => ({
    symbol: normalizeSymbol(asset.symbol),
    assetType: normalizeAssetType(asset.assetType),
  })), (asset) => `${asset.symbol}:${asset.assetType}`).map((key) => {
    const [symbol, assetType] = key.split(':')
    return { symbol, assetType }
  })
}

function buildTimeframeSelection(input = {}, strategySnapshot) {
  const requestedTimeframe = normalizeText(input.timeframe ?? input.timeframeSelection, strategySnapshot.timeframeReferences[0] ?? 'swing').toLowerCase()
  return {
    timeframe: requestedTimeframe,
    supportedTimeframes: strategySnapshot.timeframeReferences,
    compatible: strategySnapshot.timeframeReferences.length === 0 || strategySnapshot.timeframeReferences.includes(requestedTimeframe),
  }
}

function validateDateRange(input = {}, timestamp) {
  const startDate = normalizeText(input.startDate ?? input.dateRange?.startDate, '2025-01-01')
  const endDate = normalizeText(input.endDate ?? input.dateRange?.endDate, timestamp.slice(0, 10))
  const start = new Date(`${startDate}T00:00:00.000Z`)
  const end = new Date(`${endDate}T00:00:00.000Z`)
  const validDates = !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())
  const chronological = validDates && start <= end
  const lookbackDays = chronological ? Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86400000)) : 0
  const cautions = []
  const blockers = []

  if (!validDates) blockers.push('Backtest date range contains invalid dates')
  if (validDates && !chronological) blockers.push('Backtest start date must be before end date')
  if (lookbackDays > 0 && lookbackDays < 20) cautions.push('Backtest date range is short for strategy review')

  return {
    startDate,
    endDate,
    lookbackDays,
    valid: blockers.length === 0,
    blockers,
    cautions,
  }
}

function buildInitialCapitalConfiguration(input = {}, capitalAllocation = {}) {
  const initialCapital = numberValue(input.initialCapital ?? input.initialCapitalConfiguration?.initialCapital, capitalAllocation.capital?.availableCapital ?? 100000)
  const currency = normalizeText(input.currency ?? input.initialCapitalConfiguration?.currency, 'USD')
  const blockers = []
  const cautions = []
  if (initialCapital <= 0) blockers.push('Initial capital must be greater than zero')
  if (initialCapital < 10000) cautions.push('Initial capital is below institutional paper testing threshold')

  return {
    initialCapital,
    currency,
    source: capitalAllocation.eventType ?? 'manual',
    valid: blockers.length === 0,
    blockers,
    cautions,
  }
}

function buildRiskConfigurationSnapshot({ portfolioRisk = {}, positionSizing = {}, capitalAllocation = {} }) {
  return {
    portfolioRisk: {
      eventType: portfolioRisk.eventType ?? null,
      riskLevel: portfolioRisk.summary?.riskLevel ?? 'unknown',
      openRiskPct: numberValue(portfolioRisk.summary?.openRiskPct),
    },
    positionSizing: {
      eventType: positionSizing.eventType ?? null,
      status: positionSizing.status ?? 'unknown',
      suggestedQuantity: numberValue(positionSizing.suggestedQuantity),
      dollarRisk: numberValue(positionSizing.metrics?.dollarRisk),
    },
    capitalAllocation: {
      eventType: capitalAllocation.eventType ?? null,
      allocationStatus: capitalAllocation.allocationStatus ?? 'unknown',
      availableCapital: numberValue(capitalAllocation.capital?.availableCapital),
      remainingRiskBudget: numberValue(capitalAllocation.capital?.remainingRiskBudget),
    },
    paperTrading: true,
  }
}

function buildMarketDataAdapterCompatibilityCheck(input = {}, assetUniverse = []) {
  const health = input.marketDataAdapterHealth?.health ?? input.marketDataHealth ?? {}
  const metadata = input.marketDataAdapterHealth?.metadata ?? input.marketDataAdapterMetadata ?? {}
  const supportedAssetTypes = normalizeList(metadata.assetTypes ?? [], normalizeAssetType)
  const unsupportedAssets = supportedAssetTypes.length === 0
    ? []
    : assetUniverse.filter((asset) => !supportedAssetTypes.includes(asset.assetType))
  const available = health.available !== false
  const status = health.status ?? (available ? 'healthy' : 'unavailable')

  return {
    eventType: input.marketDataAdapterHealth?.eventType ?? null,
    provider: health.provider ?? metadata.id ?? 'mock-market-data',
    status,
    available,
    stale: health.stale === true,
    supportedAssetTypes,
    unsupportedAssets,
    compatible: available && unsupportedAssets.length === 0,
    paperTrading: health.paperTrading !== false && metadata.paperTrading !== false,
  }
}

function buildReadiness({ strategySnapshot, assetUniverse, timeframeSelection, dateRangeValidation, initialCapitalConfiguration, riskConfigurationSnapshot, marketDataAdapterCompatibilityCheck }) {
  const blockers = []
  const cautions = []

  if (strategySnapshot.status !== 'active') blockers.push('Selected strategy is not active in the paper registry')
  if (assetUniverse.length === 0) blockers.push('Selected asset universe is empty')
  if (!timeframeSelection.compatible) blockers.push('Selected timeframe is not supported by strategy')
  if (!dateRangeValidation.valid) blockers.push(...dateRangeValidation.blockers)
  if (!initialCapitalConfiguration.valid) blockers.push(...initialCapitalConfiguration.blockers)
  if (!marketDataAdapterCompatibilityCheck.compatible) blockers.push('Market data adapter is not compatible with selected asset universe')
  if (marketDataAdapterCompatibilityCheck.stale) cautions.push('Market data adapter health is stale')
  if (riskConfigurationSnapshot.portfolioRisk.riskLevel === 'critical') cautions.push('Portfolio risk snapshot is critical')
  if (riskConfigurationSnapshot.positionSizing.status === 'rejected') cautions.push('Position sizing snapshot is rejected')
  if (riskConfigurationSnapshot.capitalAllocation.allocationStatus === 'blocked') cautions.push('Capital allocation snapshot is blocked')
  cautions.push(...dateRangeValidation.cautions, ...initialCapitalConfiguration.cautions)

  return {
    readinessStatus: blockers.length > 0 ? 'blocked' : cautions.length > 0 ? 'caution' : 'ready',
    blockers,
    cautions,
  }
}

export function prepareStrategyBacktestInput(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? getNowIso()
  const selectedStrategySnapshot = buildSelectedStrategySnapshot(input)
  const selectedAssetUniverse = buildSelectedAssetUniverse(input, selectedStrategySnapshot)
  const timeframeSelection = buildTimeframeSelection(input, selectedStrategySnapshot)
  const dateRangeValidation = validateDateRange(input, timestamp)
  const initialCapitalConfiguration = buildInitialCapitalConfiguration(input, input.capitalAllocation)
  const riskConfigurationSnapshot = buildRiskConfigurationSnapshot({
    portfolioRisk: input.portfolioRisk,
    positionSizing: input.positionSizing,
    capitalAllocation: input.capitalAllocation,
  })
  const marketDataAdapterCompatibilityCheck = buildMarketDataAdapterCompatibilityCheck(input, selectedAssetUniverse)
  const readiness = buildReadiness({
    strategySnapshot: selectedStrategySnapshot,
    assetUniverse: selectedAssetUniverse,
    timeframeSelection,
    dateRangeValidation,
    initialCapitalConfiguration,
    riskConfigurationSnapshot,
    marketDataAdapterCompatibilityCheck,
  })
  const normalizedBacktestRequest = {
    requestId: `${selectedStrategySnapshot.strategyId}-${timeframeSelection.timeframe}-${dateRangeValidation.startDate}-${dateRangeValidation.endDate}`,
    selectedStrategySnapshot,
    selectedAssetUniverse,
    timeframeSelection,
    dateRange: {
      startDate: dateRangeValidation.startDate,
      endDate: dateRangeValidation.endDate,
      lookbackDays: dateRangeValidation.lookbackDays,
    },
    initialCapitalConfiguration,
    riskConfigurationSnapshot,
    marketDataAdapterCompatibilityCheck,
    readinessStatus: readiness.readinessStatus,
    paperTrading: true,
  }
  const result = {
    eventType: STRATEGY_BACKTEST_INPUT_PREPARED_EVENT,
    paperTrading: true,
    timestamp,
    normalizedBacktestRequest,
    selectedStrategySnapshot,
    selectedAssetUniverse,
    timeframeSelection,
    dateRangeValidation,
    initialCapitalConfiguration,
    riskConfigurationSnapshot,
    marketDataAdapterCompatibilityCheck,
    readinessStatus: readiness.readinessStatus,
    blockers: readiness.blockers,
    cautions: readiness.cautions,
    summary: `${selectedStrategySnapshot.strategyName} backtest input is ${readiness.readinessStatus} for future paper backtesting.`,
    sourceEvents: {
      strategyBlueprint: input.strategyBlueprintValidation?.eventType ?? null,
      strategyLifecycle: input.strategyLifecycle?.eventType ?? null,
      strategyRegistry: input.strategyRegistry?.eventType ?? null,
      marketDataAdapter: input.marketDataAdapterHealth?.eventType ?? null,
      portfolioRisk: input.portfolioRisk?.eventType ?? null,
      positionSizing: input.positionSizing?.eventType ?? null,
      capitalAllocation: input.capitalAllocation?.eventType ?? null,
    },
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(STRATEGY_BACKTEST_INPUT_PREPARED_EVENT, result)
  }

  return result
}

export function createStrategyBacktestInputBuilder(options = {}) {
  return {
    prepare(input, prepareOptions = {}) {
      return prepareStrategyBacktestInput(input, { ...options, ...prepareOptions })
    },
  }
}
