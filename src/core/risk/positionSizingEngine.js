import { getAssetProfile, getQuantityStep, validateAssetQuantity } from '../../../lib/assets/index.js'
import { eventBus as defaultEventBus } from '../../../lib/core/eventBus.js'
import { evaluateDrawdownProtection } from './drawdownProtectionEngine.js'
import { evaluatePortfolioRisk } from './portfolioRiskEngine.js'

export const TRADE_POSITION_SIZE_RECOMMENDED_EVENT = 'trade.positionSize.recommended'

const defaultLimits = Object.freeze({
  fixedRiskAmount: null,
  equityRiskPct: 1,
  maxRiskPerTradePct: 1,
  maxPositionValuePct: 12,
  minQuantity: 0,
})

function numberValue(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

function round(value, decimals = 2) {
  return Number(numberValue(value).toFixed(decimals))
}

function normalizeSymbol(symbol) {
  return String(symbol ?? '').trim().toUpperCase()
}

function normalizeSide(side) {
  return String(side ?? '').trim().toLowerCase()
}

function floorToStep(value, step) {
  const numericStep = numberValue(step, 1)
  if (numericStep <= 0) return Math.floor(numberValue(value))

  const precision = String(numericStep).includes('.') ? String(numericStep).split('.')[1].length : 0
  return Number((Math.floor(numberValue(value) / numericStep) * numericStep).toFixed(precision))
}

function getAccountValue(portfolioRisk) {
  return numberValue(portfolioRisk.account?.accountValue)
}

function getBuyingPower(portfolioRisk) {
  return numberValue(portfolioRisk.account?.buyingPower, portfolioRisk.account?.cash)
}

function getCash(portfolioRisk) {
  return numberValue(portfolioRisk.account?.cash)
}

function validateSizingInputs(trade, profile) {
  const errors = []
  const symbol = normalizeSymbol(trade.symbol)
  const side = normalizeSide(trade.side)
  const price = numberValue(trade.price ?? trade.limitPrice)
  const stopPrice = numberValue(trade.stopPrice)

  if (!/^[A-Z][A-Z0-9./-]{0,19}$/.test(symbol)) errors.push('symbol is required')
  if (!['buy', 'sell', 'short', 'cover'].includes(side)) errors.push('side is unsupported')
  if (trade.paperTrading === false) errors.push('position sizing only accepts paper trades')
  if (price <= 0) errors.push('price must be greater than zero')
  if (stopPrice <= 0) errors.push('stop price must be greater than zero')
  if (Math.abs(price - stopPrice) <= 0) errors.push('stop distance must be greater than zero')
  if (!profile) errors.push('asset profile is required')

  return {
    ok: errors.length === 0,
    errors,
    normalizedTrade: {
      ...trade,
      symbol,
      side,
      price,
      stopPrice,
      paperTrading: trade.paperTrading !== false,
    },
  }
}

function buildRejectedResult({ trade, profile, portfolioRisk, drawdownProtection, guardrailDecision, errors, timestamp }) {
  return {
    eventType: TRADE_POSITION_SIZE_RECOMMENDED_EVENT,
    paperTrading: true,
    timestamp,
    status: 'rejected',
    reason: errors[0] ?? 'Position sizing rejected',
    proposedTrade: trade,
    suggestedQuantity: 0,
    quantityTerm: profile?.quantityTerm ?? 'units',
    sizing: {
      fixedRiskQuantity: 0,
      equityBasedQuantity: 0,
      stopDistanceQuantity: 0,
      maxPositionValueQuantity: 0,
      buyingPowerQuantity: 0,
      cashQuantity: 0,
    },
    metrics: {
      accountValue: round(getAccountValue(portfolioRisk)),
      cash: round(getCash(portfolioRisk)),
      buyingPower: round(getBuyingPower(portfolioRisk)),
      stopDistance: 0,
      riskPerUnit: 0,
      targetRiskAmount: 0,
      cappedRiskAmount: 0,
      notional: 0,
      marginRequirement: 0,
      dollarRisk: 0,
      riskPct: 0,
    },
    constraints: {
      drawdownProtectionStatus: drawdownProtection?.protectionStatus ?? 'unknown',
      guardrailDecision: guardrailDecision?.decision ?? 'not_evaluated',
    },
    errors,
  }
}

function calculateSizing({ trade, profile, portfolioRisk, limits }) {
  const accountValue = getAccountValue(portfolioRisk)
  const cash = getCash(portfolioRisk)
  const buyingPower = getBuyingPower(portfolioRisk)
  const multiplier = numberValue(profile.contractMultiplier, 1)
  const marginRequirementRate = numberValue(profile.margin?.initialRequirement, 1)
  const stopDistance = Math.abs(trade.price - trade.stopPrice)
  const riskPerUnit = stopDistance * multiplier
  const targetRiskAmount = numberValue(limits.fixedRiskAmount, accountValue * (numberValue(limits.equityRiskPct, 1) / 100))
  const maxRiskAmount = accountValue * (numberValue(limits.maxRiskPerTradePct, 1) / 100)
  const cappedRiskAmount = Math.min(targetRiskAmount, maxRiskAmount)
  const fixedRiskQuantity = riskPerUnit > 0 && numberValue(limits.fixedRiskAmount) > 0
    ? numberValue(limits.fixedRiskAmount) / riskPerUnit
    : Infinity
  const equityBasedQuantity = riskPerUnit > 0 ? targetRiskAmount / riskPerUnit : 0
  const stopDistanceQuantity = riskPerUnit > 0 ? cappedRiskAmount / riskPerUnit : 0
  const maxPositionValue = accountValue * (numberValue(limits.maxPositionValuePct, 12) / 100)
  const unitNotional = trade.price * multiplier
  const maxPositionValueQuantity = unitNotional > 0 ? maxPositionValue / unitNotional : 0
  const buyingPowerQuantity = unitNotional * marginRequirementRate > 0
    ? buyingPower / (unitNotional * marginRequirementRate)
    : 0
  const requiresCash = trade.side === 'buy' && ['equity', 'etf', 'crypto', 'options'].includes(profile.assetType)
  const cashQuantity = requiresCash && unitNotional > 0 ? cash / unitNotional : Infinity
  const rawQuantity = Math.min(
    fixedRiskQuantity,
    equityBasedQuantity,
    stopDistanceQuantity,
    maxPositionValueQuantity,
    buyingPowerQuantity,
    cashQuantity,
  )
  const suggestedQuantity = floorToStep(rawQuantity, getQuantityStep(profile.assetType))
  const notional = suggestedQuantity * unitNotional
  const marginRequirement = notional * marginRequirementRate
  const dollarRisk = suggestedQuantity * riskPerUnit
  const riskPct = accountValue > 0 ? (dollarRisk / accountValue) * 100 : 0

  return {
    suggestedQuantity,
    sizing: {
      fixedRiskQuantity: Number.isFinite(fixedRiskQuantity) ? round(fixedRiskQuantity, 8) : null,
      equityBasedQuantity: round(equityBasedQuantity, 8),
      stopDistanceQuantity: round(stopDistanceQuantity, 8),
      maxPositionValueQuantity: round(maxPositionValueQuantity, 8),
      buyingPowerQuantity: round(buyingPowerQuantity, 8),
      cashQuantity: Number.isFinite(cashQuantity) ? round(cashQuantity, 8) : null,
    },
    metrics: {
      accountValue: round(accountValue),
      cash: round(cash),
      buyingPower: round(buyingPower),
      stopDistance: round(stopDistance, profile.pricePrecision),
      riskPerUnit: round(riskPerUnit),
      targetRiskAmount: round(targetRiskAmount),
      cappedRiskAmount: round(cappedRiskAmount),
      notional: round(notional),
      marginRequirement: round(marginRequirement),
      dollarRisk: round(dollarRisk),
      riskPct: round(riskPct),
    },
  }
}

export function recommendPositionSize(portfolio = {}, proposedTrade = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? new Date().toISOString()
  const limits = { ...defaultLimits, ...(options.limits ?? {}) }
  const profile = getAssetProfile(proposedTrade.assetType)
  const portfolioRisk = options.portfolioRisk ?? evaluatePortfolioRisk(portfolio, { emitEvent: false })
  const drawdownProtection = options.drawdownProtection ?? evaluateDrawdownProtection(portfolio, [], { emitEvent: false })
  const validation = validateSizingInputs(proposedTrade, profile)
  const guardrailDecision = options.guardrailDecision
  const errors = [...validation.errors]

  if (drawdownProtection.protectionStatus === 'locked') {
    errors.push('drawdown protection is locked')
  }

  if (guardrailDecision?.decision === 'rejected') {
    errors.push(`guardrail rejected proposed trade: ${guardrailDecision.reason}`)
  }

  if (!validation.ok || errors.length > validation.errors.length) {
    const result = buildRejectedResult({
      trade: validation.normalizedTrade,
      profile,
      portfolioRisk,
      drawdownProtection,
      guardrailDecision,
      errors,
      timestamp,
    })

    if (emitEvent && eventBus?.emit) {
      eventBus.emit(TRADE_POSITION_SIZE_RECOMMENDED_EVENT, result)
    }

    return result
  }

  const calculated = calculateSizing({
    trade: validation.normalizedTrade,
    profile,
    portfolioRisk,
    limits,
  })
  const quantityValidation = validateAssetQuantity(calculated.suggestedQuantity, profile)
  const minQuantity = numberValue(limits.minQuantity, 0)
  const sizingErrors = []

  if (calculated.suggestedQuantity <= minQuantity) {
    sizingErrors.push('suggested quantity is below the minimum tradable size')
  }
  if (!quantityValidation.ok) {
    sizingErrors.push(quantityValidation.message)
  }

  const status = sizingErrors.length > 0 ? 'rejected' : 'recommended'
  const result = {
    eventType: TRADE_POSITION_SIZE_RECOMMENDED_EVENT,
    paperTrading: true,
    timestamp,
    status,
    reason: status === 'recommended'
      ? 'Paper position size recommended within configured constraints'
      : sizingErrors[0],
    proposedTrade: validation.normalizedTrade,
    suggestedQuantity: status === 'recommended' ? calculated.suggestedQuantity : 0,
    quantityTerm: profile.quantityTerm,
    sizing: calculated.sizing,
    metrics: calculated.metrics,
    constraints: {
      maxPositionValuePct: limits.maxPositionValuePct,
      maxRiskPerTradePct: limits.maxRiskPerTradePct,
      equityRiskPct: limits.equityRiskPct,
      drawdownProtectionStatus: drawdownProtection.protectionStatus,
      guardrailDecision: guardrailDecision?.decision ?? 'not_evaluated',
    },
    errors: sizingErrors,
    assetProfile: {
      assetType: profile.assetType,
      displayName: profile.displayName,
      quantityTerm: profile.quantityTerm,
      contractMultiplier: profile.contractMultiplier,
      margin: profile.margin,
    },
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(TRADE_POSITION_SIZE_RECOMMENDED_EVENT, result)
  }

  return result
}

export function createPositionSizingEngine(options = {}) {
  return {
    recommend(portfolio, proposedTrade, sizingOptions = {}) {
      return recommendPositionSize(portfolio, proposedTrade, { ...options, ...sizingOptions })
    },
  }
}
