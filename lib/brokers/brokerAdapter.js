import { getAssetProfile, normalizeAssetType } from '../assets/index.js'
import { eventBus as defaultEventBus } from '../core/eventBus.js'
import { simulateTradeExecution } from '../../src/core/execution/executionSimulationEngine.js'

export const BROKER_ADAPTER_CHECKED_EVENT = 'broker.adapter.checked'

export const BROKER_ADAPTER_CAPABILITIES = Object.freeze({
  ACCOUNT: 'account',
  POSITIONS: 'positions',
  ORDER_REQUESTS: 'order_requests',
  SIMULATED_ORDERS: 'simulated_orders',
  HEALTH: 'health',
})

const defaultPaperAccount = Object.freeze({
  id: 'paper-broker-demo',
  cash: 100000,
  equity: 100000,
  buyingPower: 100000,
  realizedPnl: 0,
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

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function normalizeBrokerError(error, adapterId) {
  const message = error instanceof Error ? error.message : String(error ?? 'broker adapter failed')

  return {
    ok: false,
    provider: adapterId,
    status: 'error',
    paperTrading: true,
    error: {
      code: 'broker_adapter_error',
      message,
    },
    checkedAt: new Date().toISOString(),
  }
}

export function normalizeBrokerAccount(account = {}, provider = 'mock-paper-broker-adapter') {
  const cash = numberValue(account.cash)
  const equity = numberValue(account.equity ?? account.accountValue, cash)

  return {
    accountId: String(account.id ?? account.accountId ?? 'paper-account'),
    provider,
    paperTrading: true,
    cash: round(cash),
    equity: round(equity),
    buyingPower: round(numberValue(account.buyingPower, cash)),
    realizedPnl: round(numberValue(account.realizedPnl)),
    positionMarketValue: round(numberValue(account.positionMarketValue, equity - cash)),
    updatedAt: account.updatedAt ?? account.timestamp ?? new Date().toISOString(),
  }
}

export function normalizeBrokerPosition(position = {}, provider = 'mock-paper-broker-adapter') {
  const assetType = normalizeAssetType(position.assetType)
  const profile = getAssetProfile(assetType)
  const quantity = numberValue(position.quantity)
  const currentPrice = numberValue(position.currentPrice ?? position.averagePrice ?? position.entryPrice)
  const marketValue = numberValue(
    position.marketValue,
    quantity * currentPrice * numberValue(position.contractMultiplier ?? profile.contractMultiplier, 1),
  )

  return {
    symbol: normalizeSymbol(position.symbol),
    assetType,
    provider,
    paperTrading: true,
    side: String(position.side ?? 'long').toLowerCase() === 'short' ? 'short' : 'long',
    quantity,
    quantityTerm: position.quantityTerm ?? profile.quantityTerm,
    averagePrice: numberValue(position.averagePrice ?? position.entryPrice ?? currentPrice),
    currentPrice,
    marketValue: round(marketValue),
    unrealizedPnl: round(numberValue(position.unrealizedPnl)),
    realizedPnl: round(numberValue(position.realizedPnl)),
    updatedAt: position.updatedAt ?? position.timestamp ?? new Date().toISOString(),
  }
}

export function normalizeOrderRequest(order = {}, provider = 'mock-paper-broker-adapter') {
  const assetType = normalizeAssetType(order.assetType)
  const profile = getAssetProfile(assetType)
  const side = String(order.side ?? '').trim().toLowerCase()
  const orderType = String(order.orderType ?? order.type ?? 'market').trim().toLowerCase()

  return {
    orderId: order.id ?? order.orderId ?? null,
    provider,
    paperTrading: order.paperTrading !== false,
    symbol: normalizeSymbol(order.symbol),
    assetType,
    side,
    orderType,
    quantity: numberValue(order.quantity),
    quantityTerm: profile.quantityTerm,
    price: numberValue(order.price ?? order.limitPrice),
    stopPrice: numberValue(order.stopPrice),
    timeInForce: String(order.timeInForce ?? 'DAY').trim().toUpperCase(),
    requestedAt: order.requestedAt ?? order.timestamp ?? new Date().toISOString(),
  }
}

export function normalizeSimulatedOrderResponse(execution = {}, provider = 'mock-paper-broker-adapter') {
  const fill = execution.fill

  return {
    ok: execution.finalStatus === 'filled',
    provider,
    paperTrading: true,
    status: execution.finalStatus ?? execution.status ?? 'unknown',
    brokerOrderId: execution.brokerOrderId ?? `${provider}-${execution.proposedTrade?.id ?? execution.proposedTrade?.symbol ?? 'paper-order'}`,
    reason: execution.reason ?? null,
    guardrailDecision: execution.guardrailDecision ?? null,
    proposedTrade: execution.proposedTrade ? normalizeOrderRequest(execution.proposedTrade, provider) : null,
    fill: fill ? {
      symbol: normalizeSymbol(fill.symbol),
      assetType: normalizeAssetType(fill.assetType),
      side: fill.side,
      orderType: fill.orderType,
      quantity: numberValue(fill.quantity),
      quantityTerm: fill.quantityTerm ?? getAssetProfile(fill.assetType).quantityTerm,
      fillPrice: numberValue(fill.fillPrice),
      referencePrice: numberValue(fill.referencePrice),
      slippageBps: round(fill.slippageBps),
      slippageAmount: round(fill.slippageAmount),
      fees: round(fill.fees),
      notional: round(fill.notional),
      cashImpact: round(fill.cashImpact),
    } : null,
    eventType: execution.eventType ?? null,
    simulatedAt: execution.timestamp ?? new Date().toISOString(),
  }
}

export function createBrokerAdapterInterface(adapter) {
  const requiredMethods = ['getAccount', 'getPositions', 'normalizeOrderRequest', 'normalizeOrderResponse', 'submitPaperOrder', 'checkHealth']
  const missing = requiredMethods.filter((method) => typeof adapter?.[method] !== 'function')

  if (missing.length > 0) {
    throw new Error(`broker adapter missing methods: ${missing.join(', ')}`)
  }

  return adapter
}

export function createMockPaperBrokerAdapter(options = {}) {
  const adapterId = options.id ?? 'mock-paper-broker-adapter'
  const eventBus = options.eventBus ?? defaultEventBus
  let lastSuccessfulSync = null
  let lastError = null

  function getMetadata() {
    return {
      id: adapterId,
      name: options.name ?? 'Atlas Mock Paper Broker Adapter',
      default: true,
      paperTrading: true,
      liveOrders: false,
      assetTypes: ['equity', 'etf', 'forex', 'crypto', 'futures', 'options'],
      capabilities: Object.values(BROKER_ADAPTER_CAPABILITIES),
    }
  }

  function markSuccess(timestamp = new Date().toISOString()) {
    lastSuccessfulSync = timestamp
    lastError = null
  }

  return createBrokerAdapterInterface({
    metadata: getMetadata(),

    getProviderHealth(healthOptions = {}) {
      return {
        ok: true,
        provider: adapterId,
        status: lastError ? 'degraded' : 'healthy',
        available: true,
        paperTrading: true,
        liveOrders: false,
        default: true,
        lastSuccessfulSync,
        lastError,
        checkedAt: getNowIso(healthOptions.now),
      }
    },

    async checkHealth(checkOptions = {}) {
      try {
        const health = this.getProviderHealth(checkOptions)
        if (eventBus?.emit) eventBus.emit(BROKER_ADAPTER_CHECKED_EVENT, health)
        return health
      } catch (error) {
        const normalized = normalizeBrokerError(error, adapterId)
        lastError = normalized.error.message
        if (eventBus?.emit) eventBus.emit(BROKER_ADAPTER_CHECKED_EVENT, normalized)
        return normalized
      }
    },

    async getAccount(account = options.account ?? defaultPaperAccount) {
      const data = normalizeBrokerAccount(account, adapterId)
      markSuccess(data.updatedAt)

      return {
        ok: true,
        provider: adapterId,
        data,
        health: this.getProviderHealth(),
        receivedAt: new Date().toISOString(),
      }
    },

    async getPositions(positions = options.positions ?? []) {
      const data = positions.map((position) => normalizeBrokerPosition(position, adapterId))
      markSuccess()

      return {
        ok: true,
        provider: adapterId,
        data,
        health: this.getProviderHealth(),
        receivedAt: new Date().toISOString(),
      }
    },

    normalizeOrderRequest(order) {
      return normalizeOrderRequest(order, adapterId)
    },

    normalizeOrderResponse(execution) {
      return normalizeSimulatedOrderResponse(execution, adapterId)
    },

    async submitPaperOrder(orderRequest = {}, submitOptions = {}) {
      try {
        const normalizedOrder = normalizeOrderRequest(orderRequest, adapterId)
        if (!normalizedOrder.paperTrading) {
          const error = normalizeBrokerError(new Error('mock broker adapter only accepts paper orders'), adapterId)
          lastError = error.error.message
          return error
        }

        const guardrailDecision = submitOptions.guardrailDecision ?? {
          approved: false,
          decision: 'missing',
          proposedTrade: normalizedOrder,
          reason: 'Missing guardrail decision',
        }
        const execution = simulateTradeExecution(
          guardrailDecision,
          submitOptions.quote ?? {},
          { emitEvent: false, ...(submitOptions.executionOptions ?? {}) },
        )
        const response = normalizeSimulatedOrderResponse(execution, adapterId)
        markSuccess(response.simulatedAt)

        return {
          ok: response.ok,
          provider: adapterId,
          data: response,
          health: this.getProviderHealth(),
          receivedAt: new Date().toISOString(),
        }
      } catch (error) {
        const normalized = normalizeBrokerError(error, adapterId)
        lastError = normalized.error.message
        return normalized
      }
    },
  })
}

export function createBrokerAdapter(options = {}) {
  return createMockPaperBrokerAdapter(options)
}
