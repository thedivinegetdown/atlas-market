import { getAssetProfile, normalizeAssetType } from '../../../lib/assets/index.js'
import { eventBus as defaultEventBus } from '../../../lib/core/eventBus.js'

export const TRADE_EXECUTION_SIMULATED_EVENT = 'trade.execution.simulated'

const defaultFeeModel = Object.freeze({
  minimumFee: 0.25,
  equityRate: 0.0005,
  etfRate: 0.0005,
  cryptoRate: 0.001,
  forexRate: 0.00002,
  futuresPerContract: 1.25,
  optionsPerContract: 0.65,
})

const defaultSlippageModel = Object.freeze({
  baseBps: 2,
  marketExtraBps: 3,
  stopExtraBps: 5,
  lowLiquidityExtraBps: 4,
})

function numberValue(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

function round(value, decimals = 2) {
  return Number(numberValue(value).toFixed(decimals))
}

function isBuySide(side) {
  return side === 'buy' || side === 'cover'
}

function normalizeQuote(quote = {}, fallbackPrice = 0) {
  const last = numberValue(quote.last ?? quote.price, fallbackPrice)
  return {
    last,
    bid: numberValue(quote.bid, last),
    ask: numberValue(quote.ask, last),
    high: numberValue(quote.high, last),
    low: numberValue(quote.low, last),
    liquidityScore: numberValue(quote.liquidityScore, 75),
    timestamp: quote.timestamp ?? quote.updatedAt ?? new Date().toISOString(),
  }
}

function getSlippageBps({ orderType, quote, slippageModel }) {
  let bps = numberValue(slippageModel.baseBps)
  if (orderType === 'market') bps += numberValue(slippageModel.marketExtraBps)
  if (orderType === 'stop' || orderType === 'stop_limit') bps += numberValue(slippageModel.stopExtraBps)
  if (quote.liquidityScore < 60) bps += numberValue(slippageModel.lowLiquidityExtraBps)
  return bps
}

function applySlippage(price, side, bps) {
  const adjustment = numberValue(price) * (numberValue(bps) / 10000)
  return isBuySide(side) ? price + adjustment : price - adjustment
}

function calculateFee({ assetType, notional, quantity, feeModel }) {
  if (assetType === 'futures') return round(quantity * numberValue(feeModel.futuresPerContract))
  if (assetType === 'options') return round(quantity * numberValue(feeModel.optionsPerContract))
  const rate = numberValue(feeModel[`${assetType}Rate`], numberValue(feeModel.equityRate))
  return round(Math.max(numberValue(feeModel.minimumFee), notional * rate))
}

function getMarketReferencePrice(trade, quote) {
  return isBuySide(trade.side) ? quote.ask : quote.bid
}

function simulateOrderTrigger(trade, quote) {
  const limitPrice = numberValue(trade.price)
  const stopPrice = numberValue(trade.stopPrice)
  const marketReference = getMarketReferencePrice(trade, quote)

  if (trade.orderType === 'market') {
    return { fillable: true, referencePrice: marketReference, reason: 'Market order accepted in paper simulator' }
  }

  if (trade.orderType === 'limit') {
    const fillable = isBuySide(trade.side)
      ? quote.ask <= limitPrice || quote.low <= limitPrice
      : quote.bid >= limitPrice || quote.high >= limitPrice
    return {
      fillable,
      referencePrice: isBuySide(trade.side) ? Math.min(limitPrice, quote.ask) : Math.max(limitPrice, quote.bid),
      reason: fillable ? 'Limit price is marketable in simulated quote' : 'Limit price is not marketable',
    }
  }

  if (trade.orderType === 'stop') {
    const triggered = isBuySide(trade.side)
      ? quote.high >= stopPrice || quote.last >= stopPrice
      : quote.low <= stopPrice || quote.last <= stopPrice
    return {
      fillable: triggered,
      referencePrice: stopPrice || marketReference,
      reason: triggered ? 'Stop trigger reached in simulated quote' : 'Stop trigger was not reached',
    }
  }

  if (trade.orderType === 'stop_limit') {
    const triggered = isBuySide(trade.side)
      ? quote.high >= stopPrice || quote.last >= stopPrice
      : quote.low <= stopPrice || quote.last <= stopPrice
    const limitFillable = isBuySide(trade.side)
      ? quote.ask <= limitPrice || quote.low <= limitPrice
      : quote.bid >= limitPrice || quote.high >= limitPrice
    return {
      fillable: triggered && limitFillable,
      referencePrice: isBuySide(trade.side) ? Math.min(limitPrice, quote.ask) : Math.max(limitPrice, quote.bid),
      reason: triggered && limitFillable
        ? 'Stop-limit trigger and limit condition passed'
        : 'Stop-limit conditions were not both satisfied',
    }
  }

  return { fillable: false, referencePrice: 0, reason: 'Unsupported order type' }
}

function rejectedResult({ guardrailDecision, quote, reason, timestamp }) {
  return {
    eventType: TRADE_EXECUTION_SIMULATED_EVENT,
    paperTrading: true,
    timestamp,
    portfolioId: guardrailDecision?.portfolioId ?? 'paper-portfolio',
    status: 'rejected',
    finalStatus: 'rejected',
    reason,
    guardrailDecision: guardrailDecision?.decision ?? 'missing',
    proposedTrade: guardrailDecision?.proposedTrade ?? null,
    quote,
    fill: null,
  }
}

export function simulateTradeExecution(guardrailDecision = {}, quote = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? new Date().toISOString()
  const feeModel = { ...defaultFeeModel, ...(options.feeModel ?? {}) }
  const slippageModel = { ...defaultSlippageModel, ...(options.slippageModel ?? {}) }

  let result
  if (!guardrailDecision?.approved) {
    result = rejectedResult({
      guardrailDecision,
      quote,
      reason: 'Execution rejected because guardrail decision was not approved',
      timestamp,
    })
  } else {
    const trade = guardrailDecision.proposedTrade
    const assetType = normalizeAssetType(trade.assetType)
    const profile = getAssetProfile(assetType)
    const normalizedQuote = normalizeQuote(quote, trade.price)
    const trigger = simulateOrderTrigger(trade, normalizedQuote)

    if (!trigger.fillable) {
      result = {
        eventType: TRADE_EXECUTION_SIMULATED_EVENT,
        paperTrading: true,
        timestamp,
        portfolioId: guardrailDecision.portfolioId,
        status: 'not_filled',
        finalStatus: 'not_filled',
        reason: trigger.reason,
        guardrailDecision: guardrailDecision.decision,
        proposedTrade: trade,
        quote: normalizedQuote,
        fill: null,
      }
    } else {
      const slippageBps = getSlippageBps({ orderType: trade.orderType, quote: normalizedQuote, slippageModel })
      const rawFillPrice = applySlippage(trigger.referencePrice, trade.side, slippageBps)
      const fillPrice = Number(rawFillPrice.toFixed(profile.pricePrecision))
      const notional = fillPrice * numberValue(trade.quantity) * numberValue(profile.contractMultiplier, 1)
      const fee = calculateFee({ assetType, notional, quantity: trade.quantity, feeModel })
      const slippageAmount = Math.abs(fillPrice - trigger.referencePrice) * numberValue(trade.quantity) * numberValue(profile.contractMultiplier, 1)
      const cashImpact = isBuySide(trade.side) ? -(notional + fee) : notional - fee

      result = {
        eventType: TRADE_EXECUTION_SIMULATED_EVENT,
        paperTrading: true,
        timestamp,
        portfolioId: guardrailDecision.portfolioId,
        status: 'filled',
        finalStatus: 'filled',
        reason: trigger.reason,
        guardrailDecision: guardrailDecision.decision,
        proposedTrade: trade,
        quote: normalizedQuote,
        fill: {
          symbol: trade.symbol,
          assetType,
          side: trade.side,
          orderType: trade.orderType,
          quantity: trade.quantity,
          quantityTerm: profile.quantityTerm,
          referencePrice: round(trigger.referencePrice, profile.pricePrecision),
          fillPrice,
          slippageBps: round(slippageBps),
          slippageAmount: round(slippageAmount),
          fees: fee,
          notional: round(notional),
          cashImpact: round(cashImpact),
        },
      }
    }
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(TRADE_EXECUTION_SIMULATED_EVENT, result)
  }

  return result
}

export function createExecutionSimulationEngine(options = {}) {
  return {
    simulate(guardrailDecision, quote, simulationOptions = {}) {
      return simulateTradeExecution(guardrailDecision, quote, { ...options, ...simulationOptions })
    },
  }
}
