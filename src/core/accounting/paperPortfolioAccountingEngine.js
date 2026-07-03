import { getAssetProfile, normalizeAssetType } from '../../../lib/assets/index.js'
import { eventBus as defaultEventBus } from '../../../lib/core/eventBus.js'

export const PORTFOLIO_ACCOUNTING_UPDATED_EVENT = 'portfolio.accounting.updated'

function numberValue(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

function round(value, decimals = 2) {
  return Number(numberValue(value).toFixed(decimals))
}

function normalizeSymbol(symbol) {
  return String(symbol ?? '').trim().toUpperCase()
}

function getSideFromFill(fill) {
  if (fill.side === 'short' || fill.side === 'cover') return 'short'
  return 'long'
}

function normalizePosition(position = {}) {
  const assetType = normalizeAssetType(position.assetType)
  const profile = getAssetProfile(assetType)
  const currentPrice = numberValue(position.currentPrice ?? position.averagePrice ?? position.entryPrice)
  return {
    symbol: normalizeSymbol(position.symbol),
    assetType,
    side: String(position.side ?? 'long').toLowerCase() === 'short' ? 'short' : 'long',
    quantity: numberValue(position.quantity),
    averagePrice: numberValue(position.averagePrice ?? position.entryPrice ?? currentPrice),
    currentPrice,
    realizedPnl: round(numberValue(position.realizedPnl)),
    quantityTerm: profile.quantityTerm,
    contractMultiplier: numberValue(profile.contractMultiplier, 1),
  }
}

function getPositionKey(position) {
  return `${normalizeSymbol(position.symbol)}:${normalizeAssetType(position.assetType)}:${String(position.side ?? 'long').toLowerCase()}`
}

function getFillKey(fill) {
  return `${normalizeSymbol(fill.symbol)}:${normalizeAssetType(fill.assetType)}:${getSideFromFill(fill)}`
}

function isOpeningSide(side) {
  return side === 'buy' || side === 'short'
}

function isClosingSide(side) {
  return side === 'sell' || side === 'cover'
}

function calculatePositionMarketValue(position) {
  const value = position.quantity * position.currentPrice * position.contractMultiplier
  return position.side === 'short' ? -value : value
}

function calculateUnrealizedPnl(position) {
  const priceDelta = position.side === 'short'
    ? position.averagePrice - position.currentPrice
    : position.currentPrice - position.averagePrice
  return priceDelta * position.quantity * position.contractMultiplier
}

function summarizePositions(positions) {
  return positions.map((position) => ({
    ...position,
    marketValue: round(calculatePositionMarketValue(position)),
    unrealizedPnl: round(calculateUnrealizedPnl(position)),
  }))
}

function applyOpeningFill(position, fill) {
  const quantity = numberValue(fill.quantity)
  const fillPrice = numberValue(fill.fillPrice)

  if (!position) {
    return {
      symbol: normalizeSymbol(fill.symbol),
      assetType: normalizeAssetType(fill.assetType),
      side: getSideFromFill(fill),
      quantity,
      averagePrice: fillPrice,
      currentPrice: fillPrice,
      realizedPnl: 0,
      quantityTerm: fill.quantityTerm,
      contractMultiplier: numberValue(getAssetProfile(fill.assetType).contractMultiplier, 1),
    }
  }

  const nextQuantity = position.quantity + quantity
  const nextAveragePrice = nextQuantity > 0
    ? ((position.averagePrice * position.quantity) + (fillPrice * quantity)) / nextQuantity
    : 0

  return {
    ...position,
    quantity: round(nextQuantity, 8),
    averagePrice: round(nextAveragePrice, 8),
    currentPrice: fillPrice,
  }
}

function applyClosingFill(position, fill) {
  if (!position || position.quantity <= 0) {
    return {
      position: null,
      realizedPnl: 0,
      error: 'No matching paper position exists for this closing fill',
    }
  }

  const quantity = numberValue(fill.quantity)
  if (quantity > position.quantity) {
    return {
      position,
      realizedPnl: 0,
      error: 'Closing fill quantity exceeds open paper position',
    }
  }

  const fillPrice = numberValue(fill.fillPrice)
  const multiplier = numberValue(position.contractMultiplier, 1)
  const grossPnl = position.side === 'short'
    ? (position.averagePrice - fillPrice) * quantity * multiplier
    : (fillPrice - position.averagePrice) * quantity * multiplier
  const realizedPnl = grossPnl - numberValue(fill.fees)
  const nextQuantity = round(position.quantity - quantity, 8)
  const nextPosition = nextQuantity === 0
    ? null
    : {
        ...position,
        quantity: nextQuantity,
        currentPrice: fillPrice,
        realizedPnl: round(position.realizedPnl + realizedPnl),
      }

  return {
    position: nextPosition,
    realizedPnl,
    error: null,
  }
}

function buildRejectedResult({ portfolio, execution, reason, timestamp }) {
  return {
    eventType: PORTFOLIO_ACCOUNTING_UPDATED_EVENT,
    paperTrading: true,
    timestamp,
    portfolioId: portfolio.id ?? execution?.portfolioId ?? 'paper-portfolio',
    status: 'rejected',
    reason,
    executionStatus: execution?.finalStatus ?? 'missing',
    account: {
      cash: round(numberValue(portfolio.cash)),
      equity: round(numberValue(portfolio.accountValue ?? portfolio.equity ?? portfolio.cash)),
      realizedPnl: round(numberValue(portfolio.realizedPnl)),
    },
    positions: summarizePositions((portfolio.positions ?? []).map(normalizePosition)),
    appliedFill: null,
  }
}

export function applyPaperPortfolioAccounting(portfolio = {}, execution = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? new Date().toISOString()

  let result
  if (execution?.finalStatus !== 'filled' || !execution.fill) {
    result = buildRejectedResult({
      portfolio,
      execution,
      reason: 'Accounting update rejected because simulated execution was not filled',
      timestamp,
    })
  } else {
    const fill = execution.fill
    const positionsByKey = new Map((portfolio.positions ?? [])
      .map(normalizePosition)
      .filter((position) => position.symbol && position.quantity > 0)
      .map((position) => [getPositionKey(position), position]))
    const key = getFillKey(fill)
    const existingPosition = positionsByKey.get(key)
    let realizedPnl = 0
    let status = 'updated'
    let reason = 'Paper portfolio accounting updated from simulated fill'

    if (isOpeningSide(fill.side)) {
      const nextPosition = applyOpeningFill(existingPosition, fill)
      positionsByKey.set(key, nextPosition)
      status = existingPosition ? 'position_increased' : 'position_created'
    } else if (isClosingSide(fill.side)) {
      const closed = applyClosingFill(existingPosition, fill)
      if (closed.error) {
        result = buildRejectedResult({ portfolio, execution, reason: closed.error, timestamp })
      } else {
        realizedPnl = closed.realizedPnl
        if (closed.position) {
          positionsByKey.set(key, closed.position)
          status = 'position_reduced'
        } else {
          positionsByKey.delete(key)
          status = 'position_closed'
        }
      }
    }

    if (!result) {
      const cash = round(numberValue(portfolio.cash) + numberValue(fill.cashImpact))
      const positions = summarizePositions(Array.from(positionsByKey.values()))
      const positionMarketValue = positions.reduce((sum, position) => sum + numberValue(position.marketValue), 0)
      const totalRealizedPnl = round(numberValue(portfolio.realizedPnl) + realizedPnl)
      const equity = round(cash + positionMarketValue)

      result = {
        eventType: PORTFOLIO_ACCOUNTING_UPDATED_EVENT,
        paperTrading: true,
        timestamp,
        portfolioId: portfolio.id ?? execution.portfolioId ?? 'paper-portfolio',
        status,
        reason,
        executionStatus: execution.finalStatus,
        account: {
          cash,
          equity,
          realizedPnl: totalRealizedPnl,
          realizedPnlDelta: round(realizedPnl),
          positionMarketValue: round(positionMarketValue),
        },
        positions,
        appliedFill: fill,
      }
    }
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(PORTFOLIO_ACCOUNTING_UPDATED_EVENT, result)
  }

  return result
}

export function createPaperPortfolioAccountingEngine(options = {}) {
  return {
    apply(portfolio, execution, accountingOptions = {}) {
      return applyPaperPortfolioAccounting(portfolio, execution, { ...options, ...accountingOptions })
    },
  }
}
