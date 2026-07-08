import { eventBus as defaultEventBus } from '../../../lib/core/eventBus.js'
import { applyPaperPortfolioAccounting } from '../accounting/paperPortfolioAccountingEngine.js'
import { simulateTradeExecution } from '../execution/executionSimulationEngine.js'
import { recordPaperTradeJournal } from '../journal/paperTradeJournalEngine.js'
import { evaluateTradeGuardrail } from '../risk/tradeGuardrailEngine.js'
import { composeStrategySignal } from './strategySignalComposer.js'
import { evaluateStrategyRules } from './strategyRuleEvaluationEngine.js'

export const STRATEGY_BACKTEST_EXECUTED_EVENT = 'strategy.backtest.executed'

function numberValue(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

function round(value, decimals = 2) {
  return Number(numberValue(value).toFixed(decimals))
}

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function getHistoricalReplay(input = {}) {
  return input.historicalReplay ?? input.marketReplay ?? {}
}

function getBacktestInput(input = {}) {
  return input.strategyBacktestInput ?? input.backtestInput ?? {}
}

function buildQuoteFromCandle(candle = {}) {
  const close = numberValue(candle.close)
  return {
    last: close,
    bid: numberValue(candle.close, close),
    ask: numberValue(candle.close, close),
    high: numberValue(candle.high, close),
    low: numberValue(candle.low, close),
    liquidityScore: numberValue(candle.liquidityScore, 80),
    timestamp: candle.timestamp,
  }
}

function buildProposedTrade({ candle, signal, index }) {
  const normalizedSignal = signal.normalizedStrategySignal ?? {}
  const close = numberValue(candle.close)
  const stopPrice = normalizedSignal.signalDirection === 'bearish'
    ? round(close * 1.02, 6)
    : round(close * 0.98, 6)
  const side = normalizedSignal.signalAction === 'exit'
    ? normalizedSignal.signalDirection === 'bearish' ? 'sell' : 'sell'
    : normalizedSignal.signalDirection === 'bearish' ? 'short' : 'buy'

  return {
    id: `${normalizedSignal.strategyId ?? 'strategy'}-backtest-${index + 1}`,
    strategy: normalizedSignal.strategyName,
    signal: signal.rationaleSummary,
    symbol: normalizedSignal.symbol ?? candle.symbol,
    assetType: normalizedSignal.assetType ?? candle.assetType,
    side,
    orderType: 'market',
    quantity: Math.max(1, Math.floor(numberValue(signal.positionSizingSnapshot?.suggestedQuantity, 1))),
    price: close,
    stopPrice,
    timeInForce: 'DAY',
    paperTrading: true,
  }
}

function shouldGenerateTrade(signal = {}) {
  const normalizedSignal = signal.normalizedStrategySignal ?? {}
  return signal.signalStatus === 'composed'
    && normalizedSignal.compatibleWithAIDecisionOrchestrator === true
    && ['entry', 'exit'].includes(normalizedSignal.signalAction)
}

function buildBlockedResult({ input, timestamp, reason }) {
  const historicalReplay = getHistoricalReplay(input)
  const backtestInput = getBacktestInput(input)
  return {
    eventType: STRATEGY_BACKTEST_EXECUTED_EVENT,
    paperTrading: true,
    timestamp,
    backtestExecutionStatus: 'blocked',
    reason,
    session: {
      sessionId: historicalReplay.replaySessionConfiguration?.sessionId ?? 'backtest-session',
      strategyId: backtestInput.selectedStrategySnapshot?.strategyId ?? backtestInput.normalizedBacktestRequest?.selectedStrategySnapshot?.strategyId ?? 'strategy-blueprint',
      symbol: historicalReplay.replaySessionConfiguration?.symbol ?? 'MARKET',
      timeframe: historicalReplay.replaySessionConfiguration?.timeframe ?? 'swing',
    },
    replayStepConsumption: [],
    strategyRuleEvaluations: [],
    strategySignalCompositions: [],
    simulatedPaperTrades: [],
    lifecycleReferences: buildLifecycleReferences(input),
    summary: `Backtest execution blocked: ${reason}.`,
    sourceEvents: buildSourceEvents(input),
  }
}

function buildLifecycleReferences(input = {}) {
  return {
    guardrail: input.guardrailDecision?.eventType ?? input.tradeGuardrail?.eventType ?? null,
    positionSizing: input.positionSizing?.eventType ?? null,
    portfolioRisk: input.portfolioRisk?.eventType ?? null,
    executionSimulation: input.executionSimulation?.eventType ?? null,
    accounting: input.accountingUpdate?.eventType ?? null,
    journal: input.journalRecord?.eventType ?? null,
    paperTrading: true,
  }
}

function buildSourceEvents(input = {}) {
  return {
    strategyBlueprint: input.strategyBlueprintValidation?.eventType ?? null,
    strategyBacktestInput: getBacktestInput(input).eventType ?? null,
    historicalReplay: getHistoricalReplay(input).eventType ?? null,
    guardrail: input.guardrailDecision?.eventType ?? input.tradeGuardrail?.eventType ?? null,
    positionSizing: input.positionSizing?.eventType ?? null,
    portfolioRisk: input.portfolioRisk?.eventType ?? null,
  }
}

function runCandleStep({ input, candle, index, portfolio }) {
  const strategyRuleEvaluation = evaluateStrategyRules({
    strategyBlueprintValidation: input.strategyBlueprintValidation,
    symbol: candle.symbol,
    assetType: candle.assetType,
    timeframe: getHistoricalReplay(input).replaySessionConfiguration?.timeframe,
    researchDecisionContext: input.researchDecisionContext,
    researchSignalScore: input.researchSignalScore,
    researchEnhancedDecision: input.researchEnhancedDecision,
    marketRegime: input.marketRegime,
    portfolioRisk: input.portfolioRisk,
    positionSizing: input.positionSizing,
    tradeGuardrail: input.guardrailDecision ?? input.tradeGuardrail,
    multiTimeframeContext: input.multiTimeframeContext,
  }, { emitEvent: false, timestamp: candle.timestamp })
  const strategySignalComposition = composeStrategySignal({
    strategyBlueprintValidation: input.strategyBlueprintValidation,
    strategyRuleEvaluation,
    symbol: candle.symbol,
    assetType: candle.assetType,
    timeframe: getHistoricalReplay(input).replaySessionConfiguration?.timeframe,
    researchDecisionContext: input.researchDecisionContext,
    researchSignalScore: input.researchSignalScore,
    researchEnhancedDecision: input.researchEnhancedDecision,
    marketRegime: input.marketRegime,
    portfolioRisk: input.portfolioRisk,
    positionSizing: input.positionSizing,
  }, { emitEvent: false, timestamp: candle.timestamp })
  strategySignalComposition.positionSizingSnapshot = {
    eventType: input.positionSizing?.eventType ?? null,
    status: input.positionSizing?.status ?? 'unknown',
    suggestedQuantity: input.positionSizing?.suggestedQuantity ?? 1,
  }

  if (!shouldGenerateTrade(strategySignalComposition)) {
    return {
      portfolio,
      step: {
        candle,
        strategyRuleEvaluation,
        strategySignalComposition,
        proposedTrade: null,
        guardrailDecision: null,
        executionSimulation: null,
        accountingUpdate: null,
        journalRecord: null,
      },
    }
  }

  const proposedTrade = buildProposedTrade({ candle, signal: strategySignalComposition, index })
  const guardrailDecision = evaluateTradeGuardrail(portfolio, proposedTrade, {
    emitEvent: false,
    currentRisk: input.portfolioRisk,
    limits: input.guardrailLimits,
    timestamp: candle.timestamp,
  })
  const executionSimulation = simulateTradeExecution(guardrailDecision, buildQuoteFromCandle(candle), {
    emitEvent: false,
    timestamp: candle.timestamp,
  })
  const accountingUpdate = applyPaperPortfolioAccounting(portfolio, executionSimulation, {
    emitEvent: false,
    timestamp: candle.timestamp,
  })
  const journalRecord = recordPaperTradeJournal({
    proposedTrade,
    guardrailDecision,
    executionSimulation,
    accountingUpdate,
  }, { emitEvent: false, timestamp: candle.timestamp })

  return {
    portfolio: accountingUpdate.status === 'rejected'
      ? portfolio
      : {
          id: accountingUpdate.portfolioId,
          cash: accountingUpdate.account.cash,
          accountValue: accountingUpdate.account.equity,
          buyingPower: accountingUpdate.account.cash,
          realizedPnl: accountingUpdate.account.realizedPnl,
          positions: accountingUpdate.positions,
        },
    step: {
      candle,
      strategyRuleEvaluation,
      strategySignalComposition,
      proposedTrade,
      guardrailDecision,
      executionSimulation,
      accountingUpdate,
      journalRecord,
    },
  }
}

export function executeStrategyBacktest(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? getNowIso()
  const historicalReplay = getHistoricalReplay(input)
  const backtestInput = getBacktestInput(input)

  if (backtestInput.readinessStatus === 'blocked') {
    return buildBlockedResult({ input, timestamp, reason: 'Backtest input readiness is blocked' })
  }
  if (historicalReplay.replayStepOutput?.status === 'blocked') {
    return buildBlockedResult({ input, timestamp, reason: 'Historical replay step is blocked' })
  }

  const candles = historicalReplay.normalizedHistoricalCandles ?? []
  if (candles.length === 0) {
    return buildBlockedResult({ input, timestamp, reason: 'No replay candles are available' })
  }

  const cursorIndex = historicalReplay.replayCursorState?.cursorIndex ?? candles.length - 1
  const consumedCandles = candles.slice(0, Math.min(cursorIndex + 1, candles.length))
  let portfolio = input.paperPortfolio ?? {
    id: 'paper-backtest-portfolio',
    cash: backtestInput.initialCapitalConfiguration?.initialCapital
      ?? backtestInput.normalizedBacktestRequest?.initialCapitalConfiguration?.initialCapital
      ?? 100000,
    accountValue: backtestInput.initialCapitalConfiguration?.initialCapital
      ?? backtestInput.normalizedBacktestRequest?.initialCapitalConfiguration?.initialCapital
      ?? 100000,
    buyingPower: backtestInput.initialCapitalConfiguration?.initialCapital
      ?? backtestInput.normalizedBacktestRequest?.initialCapitalConfiguration?.initialCapital
      ?? 100000,
    positions: [],
    realizedPnl: 0,
  }
  const steps = consumedCandles.map((candle, index) => {
    const result = runCandleStep({ input, candle, index, portfolio })
    portfolio = result.portfolio
    return result.step
  })
  const simulatedPaperTrades = steps
    .filter((step) => step.proposedTrade)
    .map((step) => ({
      proposedTrade: step.proposedTrade,
      guardrailDecision: step.guardrailDecision,
      executionSimulation: step.executionSimulation,
      accountingUpdate: step.accountingUpdate,
      journalRecord: step.journalRecord,
    }))
  const filledTrades = simulatedPaperTrades.filter((trade) => trade.executionSimulation?.finalStatus === 'filled')
  const backtestExecutionStatus = historicalReplay.replayCursorState?.hasNext ? 'running' : 'completed'
  const result = {
    eventType: STRATEGY_BACKTEST_EXECUTED_EVENT,
    paperTrading: true,
    timestamp,
    backtestExecutionStatus,
    session: {
      sessionId: historicalReplay.replaySessionConfiguration?.sessionId ?? 'backtest-session',
      strategyId: historicalReplay.replaySessionConfiguration?.strategyId ?? backtestInput.selectedStrategySnapshot?.strategyId ?? 'strategy-blueprint',
      symbol: historicalReplay.replaySessionConfiguration?.symbol ?? consumedCandles[0]?.symbol ?? 'MARKET',
      timeframe: historicalReplay.replaySessionConfiguration?.timeframe ?? 'swing',
      consumedCandles: consumedCandles.length,
      totalCandles: candles.length,
    },
    replayStepConsumption: steps.map((step) => ({
      timestamp: step.candle.timestamp,
      close: step.candle.close,
      signalStatus: step.strategySignalComposition.signalStatus,
      action: step.strategySignalComposition.normalizedStrategySignal.signalAction,
      tradeGenerated: Boolean(step.proposedTrade),
    })),
    strategyRuleEvaluations: steps.map((step) => step.strategyRuleEvaluation),
    strategySignalCompositions: steps.map((step) => step.strategySignalComposition),
    simulatedPaperTrades,
    guardrailAndPositionSizingSnapshotReferences: {
      guardrail: input.guardrailDecision?.eventType ?? input.tradeGuardrail?.eventType ?? simulatedPaperTrades[0]?.guardrailDecision?.eventType ?? null,
      positionSizing: input.positionSizing?.eventType ?? null,
      portfolioRisk: input.portfolioRisk?.eventType ?? null,
    },
    executionSummary: {
      generatedTrades: simulatedPaperTrades.length,
      filledTrades: filledTrades.length,
      rejectedTrades: simulatedPaperTrades.filter((trade) => trade.guardrailDecision?.decision === 'rejected').length,
      finalCash: round(portfolio.cash),
      finalEquity: round(portfolio.accountValue),
      realizedPnl: round(portfolio.realizedPnl),
    },
    lifecycleReferences: buildLifecycleReferences(input),
    summary: `Backtest execution ${backtestExecutionStatus}: ${filledTrades.length} filled paper trades across ${consumedCandles.length} replay candles.`,
    sourceEvents: buildSourceEvents(input),
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(STRATEGY_BACKTEST_EXECUTED_EVENT, result)
  }

  return result
}

export function createStrategyBacktestExecutionEngine(options = {}) {
  return {
    execute(input, executionOptions = {}) {
      return executeStrategyBacktest(input, { ...options, ...executionOptions })
    },
  }
}
