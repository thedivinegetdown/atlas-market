import { beforeEach, describe, expect, it } from 'vitest'
import {
  ASSET_TYPES,
  calculateOrderNotional,
  formatPriceForAsset,
  getAssetProfile,
  getForexProfile,
  getMarginConfig,
  getPricePrecision,
  getQuantityLabel,
  getSymbolMetadata,
  getTickSize,
  getTradingSession,
  resolveOrderAsset,
  roundPriceForAsset,
} from '../lib/assets/index.js'
import { createPaperBroker } from '../lib/broker/paperBroker.js'
import { validateOrderPayload } from '../lib/orders/orderValidator.js'
import { createRiskEngine } from '../lib/risk/riskEngine.js'
import { resetStore } from '../lib/repositories/store.js'

beforeEach(() => {
  resetStore()
})

describe('Part 11D asset-agnostic trading foundation', () => {
  it('looks up asset profiles and keeps equity defaults stock-compatible', () => {
    const equity = getAssetProfile(ASSET_TYPES.EQUITY)

    expect(equity).toMatchObject({
      assetType: 'equity',
      quantityTerm: 'shares',
      singularQuantityTerm: 'share',
      quantityStep: 1,
      pricePrecision: 2,
      tickSize: 0.01,
      contractMultiplier: 1,
    })
    expect(getQuantityLabel(ASSET_TYPES.EQUITY, 1)).toBe('share')
    expect(getQuantityLabel(ASSET_TYPES.EQUITY, 2)).toBe('shares')
  })

  it('provides forex profile defaults without enabling live forex trading', () => {
    const forex = getForexProfile()

    expect(forex).toMatchObject({
      assetType: 'forex',
      quantityTerm: 'units',
      lotTerm: 'lots',
      quantityStep: 1000,
      pricePrecision: 5,
      tickSize: 0.0001,
    })
    expect(forex.tradingSession.label).toBe('24/5')
    expect(forex.margin.leverage).toBe(30)
  })

  it('infers symbol metadata for equities, forex pairs, and crypto symbols', () => {
    expect(getSymbolMetadata('aapl')).toMatchObject({
      symbol: 'AAPL',
      assetType: 'equity',
    })
    expect(getSymbolMetadata('eurusd')).toMatchObject({
      symbol: 'EURUSD',
      assetType: 'forex',
      baseCurrency: 'EUR',
      quoteCurrency: 'USD',
    })
    expect(getSymbolMetadata('BTC-USD')).toMatchObject({
      symbol: 'BTC-USD',
      assetType: 'crypto',
    })
  })

  it('returns price precision, tick size, session, and margin helpers by asset type', () => {
    expect(getPricePrecision(ASSET_TYPES.EQUITY)).toBe(2)
    expect(getPricePrecision(ASSET_TYPES.FOREX)).toBe(5)
    expect(getTickSize(ASSET_TYPES.FOREX)).toBe(0.0001)
    expect(roundPriceForAsset(1.23456, ASSET_TYPES.FOREX)).toBe(1.2346)
    expect(formatPriceForAsset(100.126, ASSET_TYPES.EQUITY)).toBe('100.13')
    expect(getTradingSession(ASSET_TYPES.CRYPTO).label).toBe('24/7')
    expect(getMarginConfig(ASSET_TYPES.FUTURES).leverage).toBe(10)
  })

  it('calculates notional through the asset compatibility layer', () => {
    const equityAsset = resolveOrderAsset({ symbol: 'AAPL', quantity: 2, price: 100 })
    const optionAsset = resolveOrderAsset({
      symbol: 'AAPL240119C00100000',
      assetType: ASSET_TYPES.OPTIONS,
      quantity: 2,
      price: 1.5,
    })

    expect(calculateOrderNotional({ quantity: 2, price: 100 }, equityAsset.profile)).toBe(200)
    expect(optionAsset.quantityLabel).toBe('contracts')
    expect(optionAsset.notional).toBe(300)
  })

  it('keeps the risk engine compatible with equity orders while adding asset metadata', () => {
    const engine = createRiskEngine()
    const decision = engine.evaluateOrder({ symbol: 'AAPL', quantity: 2, price: 100 }, { exposure: 0.1 }, {
      updatedAt: new Date(Date.now() - 30_000).toISOString(),
    })

    expect(decision.approved).toBe(true)
    expect(decision.assetType).toBe('equity')
    expect(decision.quantityLabel).toBe('shares')
    expect(decision.notional).toBe(200)
    expect(decision.contractMultiplier).toBe(1)
  })

  it('validates order quantities through asset profiles', () => {
    const equityError = validateOrderPayload({
      symbol: 'AAPL',
      side: 'BUY',
      type: 'LIMIT',
      quantity: 1.5,
      price: 100,
    })
    const forexError = validateOrderPayload({
      symbol: 'EURUSD',
      assetType: ASSET_TYPES.FOREX,
      side: 'BUY',
      type: 'LIMIT',
      quantity: 1500,
      price: 1.1,
    })
    const validForex = validateOrderPayload({
      symbol: 'EURUSD',
      assetType: ASSET_TYPES.FOREX,
      side: 'BUY',
      type: 'LIMIT',
      quantity: 1000,
      price: 1.1,
    })

    expect(equityError.code).toBe('invalid_quantity_increment')
    expect(forexError.code).toBe('invalid_quantity_increment')
    expect(validForex).toBeNull()
  })

  it('keeps the existing equity paper order flow working', () => {
    const broker = createPaperBroker()
    const result = broker.submitOrder({
      symbol: 'AAPL',
      side: 'BUY',
      type: 'LIMIT',
      quantity: 1,
      price: 100,
    }, {
      price: 100,
      updatedAt: new Date().toISOString(),
    }, {
      cash: 100000,
      exposure: 0.1,
    })

    expect(result.error).toBeNull()
    expect(result.order).toMatchObject({
      symbol: 'AAPL',
      assetType: 'equity',
      quantity: 1,
      quantityLabel: 'share',
      state: 'WORKING',
    })
  })
})
