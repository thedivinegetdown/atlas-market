import { ASSET_TYPES, normalizeAssetType } from './assetTypes.js'

const tradingSessions = Object.freeze({
  usRegular: {
    id: 'us_regular',
    label: 'US Regular',
    timezone: 'America/New_York',
    open: '09:30',
    close: '16:00',
    days: [1, 2, 3, 4, 5],
  },
  twentyFourFive: {
    id: 'twenty_four_five',
    label: '24/5',
    timezone: 'UTC',
    open: '00:00',
    close: '23:59',
    days: [1, 2, 3, 4, 5],
  },
  alwaysOpen: {
    id: 'always_open',
    label: '24/7',
    timezone: 'UTC',
    open: '00:00',
    close: '23:59',
    days: [0, 1, 2, 3, 4, 5, 6],
  },
})

export const ASSET_PROFILES = Object.freeze({
  [ASSET_TYPES.EQUITY]: Object.freeze({
    assetType: ASSET_TYPES.EQUITY,
    displayName: 'Equity',
    quantityTerm: 'shares',
    singularQuantityTerm: 'share',
    quantityStep: 1,
    allowFractionalQuantity: false,
    pricePrecision: 2,
    tickSize: 0.01,
    contractMultiplier: 1,
    tradingSession: tradingSessions.usRegular,
    margin: Object.freeze({
      initialRequirement: 1,
      maintenanceRequirement: 0.25,
      leverage: 1,
    }),
  }),
  [ASSET_TYPES.ETF]: Object.freeze({
    assetType: ASSET_TYPES.ETF,
    displayName: 'ETF',
    quantityTerm: 'shares',
    singularQuantityTerm: 'share',
    quantityStep: 1,
    allowFractionalQuantity: false,
    pricePrecision: 2,
    tickSize: 0.01,
    contractMultiplier: 1,
    tradingSession: tradingSessions.usRegular,
    margin: Object.freeze({
      initialRequirement: 1,
      maintenanceRequirement: 0.25,
      leverage: 1,
    }),
  }),
  [ASSET_TYPES.FOREX]: Object.freeze({
    assetType: ASSET_TYPES.FOREX,
    displayName: 'Forex',
    quantityTerm: 'units',
    singularQuantityTerm: 'unit',
    lotTerm: 'lots',
    quantityStep: 1000,
    allowFractionalQuantity: false,
    pricePrecision: 5,
    tickSize: 0.0001,
    contractMultiplier: 1,
    tradingSession: tradingSessions.twentyFourFive,
    margin: Object.freeze({
      initialRequirement: 0.0333,
      maintenanceRequirement: 0.025,
      leverage: 30,
    }),
  }),
  [ASSET_TYPES.CRYPTO]: Object.freeze({
    assetType: ASSET_TYPES.CRYPTO,
    displayName: 'Crypto',
    quantityTerm: 'units',
    singularQuantityTerm: 'unit',
    quantityStep: 0.00000001,
    allowFractionalQuantity: true,
    pricePrecision: 2,
    tickSize: 0.01,
    contractMultiplier: 1,
    tradingSession: tradingSessions.alwaysOpen,
    margin: Object.freeze({
      initialRequirement: 1,
      maintenanceRequirement: 1,
      leverage: 1,
    }),
  }),
  [ASSET_TYPES.FUTURES]: Object.freeze({
    assetType: ASSET_TYPES.FUTURES,
    displayName: 'Futures',
    quantityTerm: 'contracts',
    singularQuantityTerm: 'contract',
    quantityStep: 1,
    allowFractionalQuantity: false,
    pricePrecision: 2,
    tickSize: 0.25,
    contractMultiplier: 50,
    tradingSession: tradingSessions.twentyFourFive,
    margin: Object.freeze({
      initialRequirement: 0.1,
      maintenanceRequirement: 0.08,
      leverage: 10,
    }),
  }),
  [ASSET_TYPES.OPTIONS]: Object.freeze({
    assetType: ASSET_TYPES.OPTIONS,
    displayName: 'Options',
    quantityTerm: 'contracts',
    singularQuantityTerm: 'contract',
    quantityStep: 1,
    allowFractionalQuantity: false,
    pricePrecision: 2,
    tickSize: 0.01,
    contractMultiplier: 100,
    tradingSession: tradingSessions.usRegular,
    margin: Object.freeze({
      initialRequirement: 1,
      maintenanceRequirement: 1,
      leverage: 1,
    }),
  }),
})

export function getAssetProfile(assetType = ASSET_TYPES.EQUITY) {
  return ASSET_PROFILES[normalizeAssetType(assetType)]
}

export function getEquityProfile() {
  return getAssetProfile(ASSET_TYPES.EQUITY)
}

export function getForexProfile() {
  return getAssetProfile(ASSET_TYPES.FOREX)
}
