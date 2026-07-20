import { AppError } from '../errors/appError.js'
import { eventBus as defaultEventBus } from '../core/eventBus.js'
import { createAtlasAiGateway, ATLAS_AI_NOTICE, sanitizeAiText } from '../ai/atlasAiGateway.js'
import { evaluatePortfolioAnalytics } from '../../src/core/analytics/portfolioAnalyticsEngine.js'
import { evaluatePortfolioRisk } from '../../src/core/risk/portfolioRiskEngine.js'

export const PORTFOLIO_INTELLIGENCE_EVALUATED_EVENT = 'portfolio.intelligence.evaluated'
export const PORTFOLIO_INTELLIGENCE_VERSION = 'atlas-portfolio-intelligence-v1'

const SYMBOL_PATTERN = /^[A-Z][A-Z0-9.-]{0,14}$/

function numberValue(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, numberValue(value)))
}

function round(value, decimals = 2) {
  return Number(numberValue(value).toFixed(decimals))
}

function invalidRequest(message, metadata = {}) {
  throw new AppError('invalid_request', message, { statusCode: 400, publicMessage: message, metadata })
}

function normalizeSymbol(value) {
  const symbol = String(value ?? '').trim().toUpperCase()
  if (!SYMBOL_PATTERN.test(symbol)) invalidRequest('portfolio symbol is invalid', { symbol })
  return symbol
}

function normalizeTimestamp(value, fallback = new Date().toISOString()) {
  const timestamp = value ?? fallback
  if (Number.isNaN(Date.parse(timestamp))) invalidRequest('portfolio timestamp is invalid')
  return new Date(timestamp).toISOString()
}

function normalizePosition(position = {}, index = 0, now = new Date()) {
  if (!position || typeof position !== 'object' || Array.isArray(position)) invalidRequest('portfolio position is invalid', { index })
  const symbol = normalizeSymbol(position.symbol)
  const quantity = numberValue(position.quantity)
  const currentPrice = numberValue(position.currentPrice ?? position.price)
  const marketValue = numberValue(position.marketValue, quantity * currentPrice)
  if (!Number.isFinite(quantity) || !Number.isFinite(currentPrice) || !Number.isFinite(marketValue)) invalidRequest('portfolio numeric value is invalid', { index, symbol })
  const asOf = normalizeTimestamp(position.asOf ?? position.timestamp ?? position.updatedAt ?? now, now.toISOString())
  const ageHours = Math.max(0, (now.getTime() - Date.parse(asOf)) / 3_600_000)
  return {
    symbol,
    assetType: sanitizeAiText(position.assetType ?? 'equity', 40).toLowerCase() || 'equity',
    sector: sanitizeAiText(position.sector ?? position.category ?? 'Unclassified', 80) || 'Unclassified',
    side: String(position.side ?? 'long').toLowerCase() === 'short' ? 'short' : 'long',
    quantity,
    averagePrice: numberValue(position.averagePrice ?? position.averageCost ?? position.entryPrice),
    currentPrice,
    marketValue,
    unrealizedPnl: numberValue(position.unrealizedPnl),
    realizedPnl: numberValue(position.realizedPnl),
    volatility: clamp(position.volatility, 0, 100),
    liquidityScore: clamp(position.liquidityScore ?? 70, 0, 100),
    riskPct: clamp(position.riskPct, 0, 100),
    asOf,
    stale: position.stale === true || ageHours > 24,
    missingData: Array.isArray(position.missingData) ? position.missingData.map((item) => sanitizeAiText(item, 80)).filter(Boolean).slice(0, 8) : [],
  }
}

function allocation(items, key, total) {
  const grouped = new Map()
  for (const item of items) {
    const name = item[key] || 'Unclassified'
    const current = grouped.get(name) ?? { name, marketValue: 0, count: 0 }
    current.marketValue += Math.abs(numberValue(item.marketValue))
    current.count += 1
    grouped.set(name, current)
  }
  return Array.from(grouped.values()).map((entry) => ({
    ...entry,
    marketValue: round(entry.marketValue),
    weight: total > 0 ? round((entry.marketValue / total) * 100) : 0,
  })).sort((left, right) => right.weight - left.weight)
}

function concentrationScore(symbolAllocation = []) {
  const largest = symbolAllocation[0]?.weight ?? 0
  const hhi = symbolAllocation.reduce((sum, item) => sum + ((item.weight / 100) ** 2), 0) * 100
  return clamp((largest * 0.7) + (hhi * 0.3), 0, 100)
}

function diversificationScore(symbolAllocation = [], sectorAllocation = []) {
  if (symbolAllocation.length === 0) return 0
  const concentration = concentrationScore(symbolAllocation)
  const breadth = Math.min(30, symbolAllocation.length * 5)
  const sectors = Math.min(20, sectorAllocation.length * 4)
  return clamp(100 - concentration + breadth + sectors, 0, 100)
}

function riskTier(score) {
  if (score >= 75) return 'strong'
  if (score >= 55) return 'balanced'
  if (score >= 35) return 'caution'
  return 'fragile'
}

export function evaluatePortfolioHealth(input = {}, options = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalidRequest('portfolio input is invalid')
  const now = new Date(options.timestamp ?? Date.now())
  const positions = Array.isArray(input.positions) ? input.positions.map((position, index) => normalizePosition(position, index, now)) : []
  if (input.positions && !Array.isArray(input.positions)) invalidRequest('portfolio positions are invalid')
  const explicitAccountValue = input.accountValue ?? input.equity ?? input.account?.equity ?? input.cash
  if (explicitAccountValue !== undefined && !Number.isFinite(Number(explicitAccountValue))) invalidRequest('portfolio account value is invalid')
  const accountValue = Math.max(0, numberValue(input.accountValue ?? input.equity ?? input.account?.equity ?? input.cash))
  const cash = Math.max(0, numberValue(input.cash ?? input.account?.cash))
  const totalExposure = positions.reduce((sum, position) => sum + Math.abs(position.marketValue), 0)
  const sectorAllocation = allocation(positions, 'sector', totalExposure)
  const symbolAllocation = allocation(positions, 'symbol', totalExposure).map((entry) => ({ ...entry, symbol: entry.name }))
  const unrealized = positions.reduce((sum, position) => sum + position.unrealizedPnl, 0)
  const realized = positions.reduce((sum, position) => sum + position.realizedPnl, 0)
  const weightedVolatility = totalExposure > 0
    ? positions.reduce((sum, position) => sum + (position.volatility * (Math.abs(position.marketValue) / totalExposure)), 0)
    : 0
  const stalePositions = positions.filter((position) => position.stale)
  const missingData = positions.flatMap((position) => position.missingData.map((field) => ({ symbol: position.symbol, field })))
  const diversification = diversificationScore(symbolAllocation, sectorAllocation)
  const concentration = concentrationScore(symbolAllocation)
  const healthScore = clamp(diversification - (concentration * 0.35) - (stalePositions.length * 6) - (missingData.length * 4), 0, 100)
  const risk = evaluatePortfolioRisk({ ...input, accountValue, cash, positions }, { emitEvent: false })
  const analytics = evaluatePortfolioAnalytics({ ...input, accountValue, cash, positions }, { emitEvent: false, riskSnapshot: risk })
  return {
    eventType: PORTFOLIO_INTELLIGENCE_EVALUATED_EVENT,
    portfolioIntelligenceVersion: PORTFOLIO_INTELLIGENCE_VERSION,
    timestamp: normalizeTimestamp(options.timestamp ?? now.toISOString()),
    portfolioId: sanitizeAiText(input.portfolioId ?? input.id ?? 'paper-portfolio', 120),
    paperTrading: true,
    advisoryOnly: true,
    healthScore: round(healthScore),
    healthTier: riskTier(healthScore),
    diversificationScore: round(diversification),
    concentrationScore: round(concentration),
    sectorAllocation,
    symbolAllocation,
    unrealizedPnlSummary: { total: round(unrealized), count: positions.length },
    realizedPnlSummary: { total: round(realized), count: positions.length },
    portfolioVolatilityEstimate: round(weightedVolatility),
    exposureSummary: {
      accountValue: round(accountValue),
      cash: round(cash),
      grossExposure: accountValue > 0 ? round((totalExposure / accountValue) * 100) : 0,
      totalExposure: round(totalExposure),
      leverage: accountValue > 0 ? round(totalExposure / accountValue) : 0,
    },
    stalePositions: stalePositions.map((position) => ({ symbol: position.symbol, asOf: position.asOf })),
    missingData,
    confidence: clamp(1 - ((stalePositions.length * 0.08) + (missingData.length * 0.04)), 0, 1),
    confidenceMetadata: {
      bounded: true,
      deterministic: true,
      stalePositionCount: stalePositions.length,
      missingDataCount: missingData.length,
      aiGeneratedMath: false,
    },
    riskSummary: {
      concentrationRisk: round(concentration),
      sectorRisk: sectorAllocation[0]?.weight ?? 0,
      allocationImbalance: analytics.drift.hasDrift,
      stalePositions: stalePositions.length,
      missingMarketData: missingData.length,
      confidenceLevel: riskTier(healthScore),
      dataFreshness: stalePositions.length ? 'stale' : 'current',
      limitations: [
        ...(positions.length === 0 ? ['No open paper positions were provided.'] : []),
        ...(missingData.length ? ['Some position data is missing.'] : []),
        ...(stalePositions.length ? ['Some position data is stale.'] : []),
      ],
    },
    observedData: {
      positionCount: positions.length,
      watchlistCount: Array.isArray(input.watchlist) ? input.watchlist.length : 0,
      opportunityCount: Array.isArray(input.opportunities) ? input.opportunities.length : 0,
      signalCount: Array.isArray(input.signals) ? input.signals.length : 0,
      sourceTimestamps: positions.map((position) => ({ symbol: position.symbol, asOf: position.asOf })).slice(0, 20),
    },
    analyticsSnapshot: {
      diversification: analytics.diversification,
      concentration: analytics.concentration,
      drift: analytics.drift,
    },
    liveOrders: false,
    brokerExecution: false,
  }
}

export async function generatePortfolioInsights(input = {}, options = {}) {
  const health = input.health ?? evaluatePortfolioHealth(input, options)
  const gateway = options.atlasAiGateway ?? createAtlasAiGateway(options)
  try {
    const result = await gateway.run({
      tenantContext: { ...(input.tenantContext ?? {}), role: input.tenantContext?.role ?? 'analyst' },
      accountId: input.accountId ?? health.portfolioId,
      requestCategory: 'portfolio_summary',
      question: 'Summarize portfolio-level concentration, diversification, stale data, watchlist overlap, and research areas without trade recommendations.',
      contextSources: {
        portfolioSummary: health,
        riskMetrics: health.riskSummary,
        scannerSummaries: { opportunities: input.opportunities ?? [] },
        signalSummaries: input.signals ?? [],
      },
      sessionId: input.sessionId ?? 'atlas-portfolio-intelligence',
      correlationId: input.correlationId,
    }, { timeoutMs: options.timeoutMs })
    const response = result.atlasAiResponse ?? {}
    return {
      status: result.atlasAiRequest?.status === 'degraded' ? 'degraded' : 'completed',
      observedData: health.observedData,
      interpretation: {
        summary: sanitizeAiText(response.summary, 700),
        observations: (response.observations ?? []).map((item) => sanitizeAiText(item, 180)).slice(0, 6),
        risks: (response.risks ?? []).map((item) => sanitizeAiText(item, 180)).slice(0, 6),
        researchAreas: (response.recommendations ?? []).map((item) => sanitizeAiText(item, 180)).slice(0, 6),
        limitations: (response.limitations ?? []).map((item) => sanitizeAiText(item, 180)).slice(0, 6),
      },
      providerHealth: result.providerHealth,
      evaluation: result.atlasAiRequest?.evaluation,
      advisoryOnlyNotice: ATLAS_AI_NOTICE,
      paperTradingOnlyNotice: 'Paper trading only; no live orders or broker execution.',
      pricePredictions: false,
      tradeRecommendations: false,
      guaranteedOutcomes: false,
      autonomousActions: false,
      liveOrders: false,
      brokerExecution: false,
      rawProviderPayloadStored: false,
      chainOfThoughtStored: false,
    }
  } catch (error) {
    return {
      status: 'degraded',
      observedData: health.observedData,
      interpretation: {
        summary: 'AI portfolio insights are unavailable; deterministic portfolio health remains available.',
        observations: ['Deterministic portfolio health was computed without provider output.'],
        risks: ['AI insight generation is degraded.'],
        researchAreas: ['Review deterministic concentration, diversification, stale data, and missing data summaries.'],
        limitations: ['No provider interpretation was used. Advisory analysis only; paper trading only.'],
      },
      providerHealth: { status: 'degraded', provider: 'none' },
      errorCode: sanitizeAiText(error?.code ?? 'ai_provider_unavailable', 80),
      advisoryOnlyNotice: ATLAS_AI_NOTICE,
      paperTradingOnlyNotice: 'Paper trading only; no live orders or broker execution.',
      pricePredictions: false,
      tradeRecommendations: false,
      guaranteedOutcomes: false,
      autonomousActions: false,
      liveOrders: false,
      brokerExecution: false,
      rawProviderPayloadStored: false,
      chainOfThoughtStored: false,
    }
  }
}

export async function evaluatePortfolioIntelligence(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const health = evaluatePortfolioHealth(input, options)
  const aiInsights = await generatePortfolioInsights({ ...input, health }, options)
  const result = {
    ...health,
    aiInsights,
    status: aiInsights.status === 'degraded' ? 'degraded' : 'completed',
    limitations: [
      ...health.riskSummary.limitations,
      'Portfolio intelligence is advisory and paper-trading only.',
      'No orders, broker actions, or autonomous workflows are created.',
    ],
    rawProviderPayloadStored: false,
    chainOfThoughtStored: false,
  }
  if (options.emitEvent !== false) eventBus?.emit?.(PORTFOLIO_INTELLIGENCE_EVALUATED_EVENT, result)
  return result
}

export function validatePortfolioHistoryFilters(input = {}) {
  const limit = Number(input.limit ?? 25)
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) invalidRequest('portfolio history limit is invalid')
  const symbol = input.symbol ? normalizeSymbol(input.symbol) : null
  const category = input.category ? sanitizeAiText(input.category, 60).toLowerCase() : null
  const riskTierValue = input.riskTier ? sanitizeAiText(input.riskTier, 40).toLowerCase() : null
  if (riskTierValue && !['strong', 'balanced', 'caution', 'fragile', 'degraded'].includes(riskTierValue)) invalidRequest('portfolio risk tier is invalid')
  const minScore = input.portfolioScore === undefined ? null : clamp(input.portfolioScore, 0, 100)
  const date = input.date ? normalizeTimestamp(input.date) : null
  return { limit, symbol, category, riskTier: riskTierValue, portfolioScore: minScore, date }
}

export function createPortfolioIntelligenceRepository({ database } = {}) {
  return {
    async createSnapshot(input = {}) {
      const snapshot = {
        id: sanitizeAiText(input.id ?? `portfolio-intelligence-${input.accountId ?? 'paper-portfolio'}-${Date.now()}`, 180),
        tenantContext: input.tenantContext ?? input.tenantScope ?? {},
        accountId: sanitizeAiText(input.accountId ?? input.portfolioId ?? 'paper-portfolio', 120),
        userId: sanitizeAiText(input.userId ?? input.tenantContext?.userId ?? '', 120),
        portfolioScore: round(input.healthScore ?? input.portfolioScore),
        riskTier: sanitizeAiText(input.healthTier ?? input.riskTier ?? 'balanced', 40),
        category: sanitizeAiText(input.category ?? 'portfolio_intelligence', 80),
        symbols: (input.symbolAllocation ?? []).map((entry) => entry.name).slice(0, 20),
        payload: {
          healthScore: input.healthScore,
          diversificationScore: input.diversificationScore,
          concentrationScore: input.concentrationScore,
          riskSummary: input.riskSummary,
          aiInsightStatus: input.aiInsights?.status,
          limitations: input.limitations,
          rawProviderPayloadStored: false,
          chainOfThoughtStored: false,
          liveOrders: false,
          brokerExecution: false,
        },
        createdAt: input.timestamp ?? new Date().toISOString(),
        expiresAt: input.expiresAt ?? null,
      }
      if (!database?.connected) return { ok: true, disabled: true, snapshot }
      await database.query(
        `INSERT INTO atlas_ai_portfolio_intelligence_snapshots
          (id, organization_id, team_workspace_id, account_id, user_id, portfolio_score, risk_tier, category, symbols, payload, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), $11)
         ON CONFLICT (id) DO NOTHING`,
        [snapshot.id, snapshot.tenantContext.organizationId, snapshot.tenantContext.teamWorkspaceId ?? null, snapshot.accountId, snapshot.userId, snapshot.portfolioScore, snapshot.riskTier, snapshot.category, snapshot.symbols, snapshot.payload, snapshot.expiresAt],
      )
      return { ok: true, snapshot }
    },
    async listSnapshots(input = {}) {
      const filters = validatePortfolioHistoryFilters(input)
      const tenantContext = input.tenantContext ?? {}
      const accountId = sanitizeAiText(input.accountId ?? 'paper-portfolio', 120)
      const userId = sanitizeAiText(input.userId ?? tenantContext.userId ?? '', 120)
      if (!database?.connected) return []
      const params = [tenantContext.organizationId, tenantContext.teamWorkspaceId ?? null, accountId, userId]
      const clauses = ['organization_id = $1', "COALESCE(team_workspace_id, '') = COALESCE($2, '')", 'account_id = $3', 'user_id = $4']
      const add = (sql, value) => { params.push(value); clauses.push(`${sql} $${params.length}`) }
      if (filters.symbol) add('symbols ? ', filters.symbol)
      if (filters.category) add('category =', filters.category)
      if (filters.riskTier) add('risk_tier =', filters.riskTier)
      if (filters.portfolioScore !== null) add('portfolio_score >=', filters.portfolioScore)
      if (filters.date) add('created_at::date =', filters.date.slice(0, 10))
      params.push(filters.limit)
      const result = await database.query(
        `SELECT id, account_id, user_id, portfolio_score, risk_tier, category, symbols, payload, created_at, expires_at
         FROM atlas_ai_portfolio_intelligence_snapshots
         WHERE ${clauses.join(' AND ')}
         ORDER BY created_at DESC
         LIMIT $${params.length}`,
        params,
      )
      return (result.rows ?? []).map((row) => ({
        id: row.id,
        accountId: row.account_id,
        userId: row.user_id,
        portfolioScore: row.portfolio_score,
        riskTier: row.risk_tier,
        category: row.category,
        symbols: row.symbols,
        payload: row.payload,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        rawProviderPayloadStored: false,
        chainOfThoughtStored: false,
      }))
    },
  }
}
