import { getAssetProfile, normalizeAssetType } from '../../../lib/assets/index.js'
import { eventBus as defaultEventBus } from '../../../lib/core/eventBus.js'
import { evaluatePortfolioRisk } from './portfolioRiskEngine.js'

export const TRADE_GUARDRAIL_EVALUATED_EVENT = 'trade.guardrail.evaluated'

const allowedSides = new Set(['buy', 'sell', 'short', 'cover'])
const allowedOrderTypes = new Set(['market', 'limit', 'stop', 'stop_limit'])

const defaultLimits = Object.freeze({
  maxRiskPerTradePct: 1,
  maxPortfolioHeatPct: 6,
  requirePaperTrading: true,
})

function numberValue(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

function round(value, decimals = 2) {
  return Number(numberValue(value).toFixed(decimals))
}

function normalizeSymbol(symbol) {
  return String(symbol ?? '').trim().toUpperCase()
}

function failCheck(name, message, metadata = {}) {
  return { name, passed: false, message, ...metadata }
}

function passCheck(name, message, metadata = {}) {
  return { name, passed: true, message, ...metadata }
}

function validateProposedTrade(trade = {}) {
  const symbol = normalizeSymbol(trade.symbol)
  const side = String(trade.side ?? '').trim().toLowerCase()
  const orderType = String(trade.orderType ?? trade.type ?? 'market').trim().toLowerCase()
  const quantity = Number(trade.quantity)
  const price = Number(trade.price ?? trade.limitPrice)
  const stopPrice = Number(trade.stopPrice)
  const validationErrors = []

  if (!/^[A-Z][A-Z0-9./-]{0,19}$/.test(symbol)) validationErrors.push('symbol is required')
  if (!allowedSides.has(side)) validationErrors.push('side is unsupported')
  if (!allowedOrderTypes.has(orderType)) validationErrors.push('order type is unsupported')
  if (!Number.isFinite(quantity) || quantity <= 0) validationErrors.push('quantity must be greater than zero')
  if (!Number.isFinite(price) || price <= 0) validationErrors.push('price must be greater than zero')
  if (!Number.isFinite(stopPrice) || stopPrice <= 0) validationErrors.push('stop price must be greater than zero')

  return {
    ok: validationErrors.length === 0,
    validationErrors,
    trade: {
      symbol,
      assetType: normalizeAssetType(trade.assetType),
      side,
      orderType,
      quantity: numberValue(quantity),
      price: numberValue(price),
      stopPrice: numberValue(stopPrice),
      timeInForce: String(trade.timeInForce ?? 'DAY').trim().toUpperCase(),
      paperTrading: trade.paperTrading !== false,
    },
  }
}

function calculateTradeRisk(trade, profile) {
  const multiplier = numberValue(profile.contractMultiplier, 1)
  const notional = trade.quantity * trade.price * multiplier
  const riskPerUnit = Math.abs(trade.price - trade.stopPrice) * multiplier
  const dollarRisk = riskPerUnit * trade.quantity
  const marginRequirement = notional * numberValue(profile.margin?.initialRequirement, 1)

  return {
    notional: round(notional),
    dollarRisk: round(dollarRisk),
    marginRequirement: round(marginRequirement),
  }
}

function buildChecks({ portfolio, trade, currentRisk, tradeRisk, limits }) {
  const accountValue = numberValue(currentRisk.account.accountValue)
  const cash = numberValue(currentRisk.account.cash)
  const buyingPower = numberValue(currentRisk.account.buyingPower, cash)
  const riskPct = accountValue > 0 ? (tradeRisk.dollarRisk / accountValue) * 100 : 100
  const portfolioHeatAfterTrade = accountValue > 0
    ? ((numberValue(currentRisk.summary.openRisk) + tradeRisk.dollarRisk) / accountValue) * 100
    : 100
  const checks = []

  checks.push(trade.paperTrading
    ? passCheck('paper_trading', 'Paper trading mode confirmed')
    : failCheck('paper_trading', 'Trade guardrail only accepts paper trades'))

  checks.push(riskPct <= limits.maxRiskPerTradePct
    ? passCheck('max_risk_per_trade', 'Trade risk is within per-trade limit', { riskPct: round(riskPct) })
    : failCheck('max_risk_per_trade', 'Trade risk exceeds per-trade limit', { riskPct: round(riskPct), limit: limits.maxRiskPerTradePct }))

  checks.push(portfolioHeatAfterTrade <= limits.maxPortfolioHeatPct
    ? passCheck('max_portfolio_heat_after_trade', 'Portfolio heat remains within limit', { portfolioHeatAfterTrade: round(portfolioHeatAfterTrade) })
    : failCheck('max_portfolio_heat_after_trade', 'Portfolio heat would exceed limit after trade', { portfolioHeatAfterTrade: round(portfolioHeatAfterTrade), limit: limits.maxPortfolioHeatPct }))

  checks.push(tradeRisk.marginRequirement <= buyingPower
    ? passCheck('buying_power', 'Buying power covers required capital', { requiredCapital: tradeRisk.marginRequirement, buyingPower: round(buyingPower) })
    : failCheck('buying_power', 'Buying power is insufficient for required capital', { requiredCapital: tradeRisk.marginRequirement, buyingPower: round(buyingPower) }))

  const requiresCash = trade.side === 'buy' && ['equity', 'etf', 'crypto', 'options'].includes(trade.assetType)
  checks.push(!requiresCash || tradeRisk.marginRequirement <= cash
    ? passCheck('cash', 'Cash check passed', { requiredCash: requiresCash ? tradeRisk.marginRequirement : 0, cash: round(cash) })
    : failCheck('cash', 'Cash is insufficient for this paper trade', { requiredCash: tradeRisk.marginRequirement, cash: round(cash) }))

  return {
    checks,
    riskPct: round(riskPct),
    portfolioHeatAfterTrade: round(portfolioHeatAfterTrade),
    accountValue,
    cash,
    buyingPower,
    portfolioId: portfolio.id ?? 'paper-portfolio',
  }
}

function buildResult({ portfolio, validation, currentRisk, limits, timestamp }) {
  const profile = getAssetProfile(validation.trade.assetType)
  const tradeRisk = validation.ok ? calculateTradeRisk(validation.trade, profile) : { notional: 0, dollarRisk: 0, marginRequirement: 0 }
  const checkContext = validation.ok
    ? buildChecks({ portfolio, trade: validation.trade, currentRisk, tradeRisk, limits })
    : {
        checks: validation.validationErrors.map((message) => failCheck('proposed_trade_validation', message)),
        riskPct: 0,
        portfolioHeatAfterTrade: numberValue(currentRisk.summary.openRiskPct),
        accountValue: numberValue(currentRisk.account.accountValue),
        cash: numberValue(currentRisk.account.cash),
        buyingPower: numberValue(currentRisk.account.buyingPower),
        portfolioId: portfolio.id ?? 'paper-portfolio',
      }
  const approved = validation.ok && checkContext.checks.every((check) => check.passed)
  const failedChecks = checkContext.checks.filter((check) => !check.passed)

  return {
    eventType: TRADE_GUARDRAIL_EVALUATED_EVENT,
    paperTrading: true,
    timestamp,
    portfolioId: checkContext.portfolioId,
    proposedTrade: validation.trade,
    approved,
    decision: approved ? 'approved' : 'rejected',
    reason: approved ? 'Trade passed all paper guardrails' : failedChecks[0]?.message ?? 'Trade failed guardrail evaluation',
    checks: checkContext.checks,
    failedChecks,
    metrics: {
      accountValue: round(checkContext.accountValue),
      cash: round(checkContext.cash),
      buyingPower: round(checkContext.buyingPower),
      notional: tradeRisk.notional,
      marginRequirement: tradeRisk.marginRequirement,
      dollarRisk: tradeRisk.dollarRisk,
      riskPct: checkContext.riskPct,
      currentPortfolioHeat: round(numberValue(currentRisk.summary.openRiskPct)),
      portfolioHeatAfterTrade: checkContext.portfolioHeatAfterTrade,
      maxRiskPerTradePct: limits.maxRiskPerTradePct,
      maxPortfolioHeatPct: limits.maxPortfolioHeatPct,
    },
    assetProfile: {
      assetType: profile.assetType,
      displayName: profile.displayName,
      quantityTerm: profile.quantityTerm,
      contractMultiplier: profile.contractMultiplier,
      margin: profile.margin,
    },
    currentPortfolioRisk: currentRisk.summary,
  }
}

export function evaluateTradeGuardrail(portfolio = {}, proposedTrade = {}, options = {}) {
  const limits = { ...defaultLimits, ...(options.limits ?? {}) }
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? new Date().toISOString()
  const currentRisk = options.currentRisk ?? evaluatePortfolioRisk(portfolio, { emitEvent: false, limits: options.portfolioRiskLimits })
  const validation = validateProposedTrade(proposedTrade)
  const result = buildResult({ portfolio, proposedTrade, validation, currentRisk, limits, timestamp })

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(TRADE_GUARDRAIL_EVALUATED_EVENT, result)
  }

  return result
}

export function createTradeGuardrailEngine(options = {}) {
  return {
    evaluate(portfolio, proposedTrade, evaluationOptions = {}) {
      return evaluateTradeGuardrail(portfolio, proposedTrade, { ...options, ...evaluationOptions })
    },
  }
}
