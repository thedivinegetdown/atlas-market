import { eventBus as defaultEventBus } from '../core/eventBus.js'
import { normalizeCandle, normalizeQuote, normalizeSymbolMetadata } from './marketNormalizer.js'

export const MARKET_DATA_CONTRACTS_NORMALIZED_EVENT = 'market.dataContracts.normalized'
export const MARKET_DATA_CONTRACT_STATUSES = Object.freeze(['ready', 'caution', 'blocked'])

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Number(value ?? 0)))
}

function safeStatus(status) {
  return MARKET_DATA_CONTRACT_STATUSES.includes(status) ? status : 'caution'
}

function normalizeReference(reference = {}) {
  return { id: reference.id ?? null, type: reference.type ?? 'reference', eventType: reference.eventType ?? null }
}

function normalizeRequest(request = {}, index = 0) {
  return {
    id: String(request.id ?? `market-data-request-${index + 1}`).slice(0, 100),
    symbol: String(request.symbol ?? 'SPY').toUpperCase().slice(0, 24),
    assetType: String(request.assetType ?? 'equity').toLowerCase().slice(0, 40),
    timeframe: String(request.timeframe ?? '1d').toLowerCase().slice(0, 20),
    dataType: String(request.dataType ?? 'quote').toLowerCase().slice(0, 40),
    providerPreference: String(request.providerPreference ?? 'mock-market-data-adapter').slice(0, 100),
  }
}

export function normalizeMarketDataContractRecord(input = {}) {
  const now = input.createdAt ?? input.timestamp ?? getNowIso()
  const tenantScope = input.tenantScope ?? input.tenantContext ?? {}
  const provider = input.provider ?? input.marketDataAdapterHealth?.metadata?.id ?? input.marketDataAdapterHealth?.health?.provider ?? 'mock-market-data-adapter'
  const requests = (input.normalizedRequests ?? input.requests ?? []).slice(0, 64).map(normalizeRequest)
  const quotes = (input.normalizedQuotes ?? input.quotes ?? []).slice(0, 128).map((quote) => normalizeQuote(quote, provider, quote))
  const candles = (input.normalizedCandles ?? input.candles ?? []).slice(0, 500).map((candle) => normalizeCandle(candle, provider, candle))
  const symbolMetadata = (input.symbolMetadata ?? input.symbols ?? requests).slice(0, 64).map((symbol) => normalizeSymbolMetadata(symbol.symbol ?? symbol, symbol))
  return {
    id: String(input.id ?? `market-data-contract-${tenantScope.organizationId ?? 'tenant'}-${Date.parse(now) || Date.now()}`),
    tenantScope: {
      organizationId: tenantScope.organizationId ?? input.organizationId ?? null,
      teamWorkspaceId: tenantScope.teamWorkspaceId ?? input.teamWorkspaceId ?? null,
      userId: tenantScope.userId ?? input.userId ?? null,
      role: tenantScope.role ?? input.role ?? null,
    },
    contractStatus: safeStatus(input.contractStatus ?? input.status),
    contractScore: clampScore(input.contractScore),
    provider,
    normalizedRequests: requests.length ? requests : [normalizeRequest()],
    normalizedQuotes: quotes,
    normalizedCandles: candles,
    symbolMetadata,
    schemaSummary: {
      quoteContractReady: input.schemaSummary?.quoteContractReady !== false,
      candleContractReady: input.schemaSummary?.candleContractReady !== false,
      symbolMetadataReady: input.schemaSummary?.symbolMetadataReady !== false,
      assetAgnostic: input.schemaSummary?.assetAgnostic !== false,
      version: String(input.schemaSummary?.version ?? 'market-data-contract-v1').slice(0, 100),
    },
    sourceReferences: (input.sourceReferences ?? []).map(normalizeReference),
    evaluatedByUserId: input.evaluatedByUserId ?? tenantScope.userId ?? null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    advisoryOnly: true,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    automaticTrading: false,
    destructiveAutomation: false,
  }
}

export function createMarketDataContractRepository({ database } = {}) {
  return {
    connected: database?.connected === true,
    async create(input) {
      const contract = normalizeMarketDataContractRecord(input)
      if (!database?.connected) return { ok: true, disabled: true, contract }
      const result = await database.query(
        `INSERT INTO atlas_market_data_contracts
          (id, organization_id, team_workspace_id, contract_status, contract_score, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET contract_status = EXCLUDED.contract_status, contract_score = EXCLUDED.contract_score, payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING payload`,
        [contract.id, contract.tenantScope.organizationId, contract.tenantScope.teamWorkspaceId, contract.contractStatus, contract.contractScore, contract],
      )
      return { ok: true, contract: normalizeMarketDataContractRecord(result.rows?.[0]?.payload ?? contract) }
    },
    async list({ tenantContext = {}, contractStatus, limit = 50 } = {}) {
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, Math.min(100, Math.max(1, Number(limit) || 50))]
      const clauses = []
      if (contractStatus) {
        params.push(safeStatus(contractStatus))
        clauses.push(`contract_status = $${params.length}`)
      }
      const result = await database.query(
        `SELECT payload FROM atlas_market_data_contracts
         WHERE organization_id = $1
           AND COALESCE(team_workspace_id, '') = COALESCE($2, '')
           ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT $3`,
        params,
      )
      return (result.rows ?? []).map((row) => normalizeMarketDataContractRecord(row.payload))
    },
  }
}

export function normalizeMarketDataContracts(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const tenantContext = input.tenantContext ?? {}
  const supplied = input.marketDataContracts ?? input.marketDataContract ?? []
  const adapterHealth = input.marketDataAdapterHealth ?? {}
  const scannerSignal = input.scannerSignal ?? {}
  const historicalReplay = input.historicalReplay ?? {}
  const provider = adapterHealth.metadata?.id ?? adapterHealth.health?.provider ?? 'mock-market-data-adapter'
  const quote = scannerSignal.quote ? normalizeQuote(scannerSignal.quote, provider, scannerSignal.quote) : null
  const candles = historicalReplay.normalizedHistoricalCandles ?? (historicalReplay.replayStepOutput?.candle ? [historicalReplay.replayStepOutput.candle] : [])
  const adapterReady = adapterHealth.health?.status === 'healthy' || adapterHealth.status === 'healthy'
  const quoteScore = quote ? 90 : 65
  const candleScore = candles.length > 0 ? 90 : 70
  const adapterScore = adapterReady ? 90 : 60
  const score = Math.round((quoteScore + candleScore + adapterScore + 90) / 4)
  const contractStatus = score >= 85 ? 'ready' : score >= 60 ? 'caution' : 'blocked'
  const sourceItems = Array.isArray(supplied) ? supplied : [supplied]
  const contracts = (sourceItems.length ? sourceItems : [normalizeMarketDataContractRecord({
    tenantContext,
    provider,
    contractStatus,
    contractScore: score,
    requests: [
      { id: 'quote-request-primary', symbol: quote?.symbol ?? input.symbol ?? 'SPY', assetType: quote?.assetType ?? input.assetType ?? 'etf', dataType: 'quote', timeframe: 'realtime' },
      { id: 'candle-request-primary', symbol: quote?.symbol ?? input.symbol ?? 'SPY', assetType: quote?.assetType ?? input.assetType ?? 'etf', dataType: 'candle', timeframe: '1d' },
    ],
    quotes: quote ? [quote] : [],
    candles,
    symbols: [{ symbol: quote?.symbol ?? input.symbol ?? 'SPY', assetType: quote?.assetType ?? input.assetType ?? 'etf' }],
    sourceReferences: [
      { id: 'market-data-adapter', type: 'market-data-adapter', eventType: adapterHealth.eventType },
      { id: 'historical-replay', type: 'historical-replay', eventType: historicalReplay.eventType },
    ],
    timestamp: options.timestamp,
  })]).map(normalizeMarketDataContractRecord)
  const marketDataContractSummary = {
    total: contracts.length,
    ready: contracts.filter((item) => item.contractStatus === 'ready').length,
    caution: contracts.filter((item) => item.contractStatus === 'caution').length,
    blocked: contracts.filter((item) => item.contractStatus === 'blocked').length,
    totalRequests: contracts.reduce((sum, item) => sum + item.normalizedRequests.length, 0),
    totalQuotes: contracts.reduce((sum, item) => sum + item.normalizedQuotes.length, 0),
    totalCandles: contracts.reduce((sum, item) => sum + item.normalizedCandles.length, 0),
    averageContractScore: contracts.length ? Math.round(contracts.reduce((sum, item) => sum + item.contractScore, 0) / contracts.length) : 0,
  }
  const marketDataContractStatus = marketDataContractSummary.blocked > 0 ? 'blocked' : marketDataContractSummary.caution > 0 ? 'caution' : 'ready'
  const result = {
    eventType: MARKET_DATA_CONTRACTS_NORMALIZED_EVENT,
    timestamp: options.timestamp ?? getNowIso(),
    marketDataContracts: contracts,
    marketDataContractSummary,
    marketDataContractStatus,
    paperTrading: true,
    liveOrders: false,
    brokerExecution: false,
    automaticTrading: false,
    destructiveAutomation: false,
    summary: `Market data contracts ${marketDataContractStatus}: ${marketDataContractSummary.totalRequests} requests, ${marketDataContractSummary.totalQuotes} quotes, and ${marketDataContractSummary.totalCandles} candles normalized.`,
  }
  if (emitEvent && eventBus?.emit) eventBus.emit(MARKET_DATA_CONTRACTS_NORMALIZED_EVENT, result)
  return result
}
