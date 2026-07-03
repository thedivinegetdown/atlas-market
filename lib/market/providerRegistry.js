import { ASSET_TYPES, normalizeAssetType } from '../assets/index.js'
import { serverLogger } from '../logging/logger.js'
import { MARKET_DATA_CAPABILITIES } from './providerContract.js'

export function createMarketDataProviderRegistry({ logger = serverLogger } = {}) {
  const providers = new Map()

  function register(provider) {
    if (!provider?.metadata?.id) {
      throw new Error('market data provider metadata id is required')
    }

    providers.set(provider.metadata.id, provider)
    return provider
  }

  function list() {
    return [...providers.values()]
      .sort((left, right) => Number(left.metadata.priority ?? 100) - Number(right.metadata.priority ?? 100))
  }

  function selectProvider({
    assetType = ASSET_TYPES.EQUITY,
    capability = MARKET_DATA_CAPABILITIES.QUOTES,
  } = {}) {
    const normalizedAssetType = normalizeAssetType(assetType)
    const selected = list().find((provider) => {
      return provider.metadata.assetTypes.includes(normalizedAssetType)
        && provider.metadata.capabilities.includes(capability)
    })

    if (selected) {
      logger.debug('market data provider selected', {
        providerId: selected.metadata.id,
        assetType: normalizedAssetType,
        capability,
      })
    } else {
      logger.warn('market data provider unavailable', {
        assetType: normalizedAssetType,
        capability,
      })
    }

    return selected ?? null
  }

  return {
    register,
    list,
    selectProvider,
    getProvider(id) {
      return providers.get(id) ?? null
    },
  }
}
