import { createEquityCurveEngine } from '../analytics/equityCurveEngine.js'
import { createPerformanceEngine } from '../analytics/performanceEngine.js'
import { createPaperBroker } from '../broker/paperBroker.js'
import { createAlertEvaluator } from '../alerts/alertEvaluator.js'
import { validateAlertPayload } from '../alerts/alertValidator.js'
import { createScannerEvaluator } from '../scanners/scannerEvaluator.js'
import { validateScannerPayload } from '../scanners/scannerValidator.js'
import { createMarketDataService } from '../market/marketDataService.js'
import { combineMarketDataProvenance } from '../market/marketDataProvenanceContract.js'
import { createDailyIndicatorPipeline } from '../market/indicators/dailyIndicatorPipeline.js'
import { createMarketRegimeOrchestrator } from '../market/regime/marketRegimeOrchestrator.js'
import { serverLogger } from '../logging/logger.js'
import { EXISTING_ADAPTIVE_STRATEGY_RECORDS, selectStrategiesForRegime } from '../strategies/adaptive/index.js'
import { scoreTradeQuality } from '../opportunities/quality/index.js'
import { buildDailyBriefing } from '../intelligence/briefing/index.js'
import { evaluatePaperCandidates } from '../opportunities/paperEvaluation/index.js'
import { createDecisionEngine } from '../decision/decisionEngine.js'
import { validateOrderPayload } from '../validation/requestValidators.js'
import { isTerminalState } from '../orders/orderStateEngine.js'
import { createPositionEngine } from '../portfolio/positionEngine.js'
import { createPortfolioEngine } from '../portfolio/portfolioEngine.js'
import { createJournalRepository } from '../repositories/journalRepository.js'
import { createAlertRepository } from '../repositories/alertRepository.js'
import { createOrderRepository } from '../repositories/orderRepository.js'
import { createPortfolioRepository } from '../repositories/portfolioRepository.js'
import { createScannerRepository } from '../repositories/scannerRepository.js'
import { getStore } from '../repositories/store.js'
import { createRiskEngine } from '../risk/riskEngine.js'
import { createRiskLimits } from '../risk/riskLimits.js'
import { createPositionSizingEngine } from '../risk/positionSizingEngine.js'
import { createSignalEngine } from '../signals/signalEngine.js'
import { tradingEventLogger, TRADING_EVENTS } from '../observability/eventLogger.js'
import { eventBus } from '../core/eventBus.js'
import { createJournalEngine } from '../journal/journalEngine.js'
import { resolveOrderAsset } from '../assets/index.js'

const defaultMarketDataService = createMarketDataService()
const defaultRegimeOrchestrator = createMarketRegimeOrchestrator({ logger: serverLogger })
const signalEngine = createSignalEngine()
const riskLimits = createRiskLimits()
const riskEngine = createRiskEngine({ limits: riskLimits })
const positionSizingEngine = createPositionSizingEngine({ limits: riskLimits })
const performanceEngine = createPerformanceEngine()
const equityCurveEngine = createEquityCurveEngine()
const portfolioEngine = createPortfolioEngine()
const positionEngine = createPositionEngine()
const alertEvaluator = createAlertEvaluator()
const decisionEngine = createDecisionEngine()

function numberValue(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

function getRepositories(overrides = {}) {
  return {
    orderRepository: overrides.orderRepository ?? createOrderRepository(),
    portfolioRepository: overrides.portfolioRepository ?? createPortfolioRepository(),
    journalRepository: overrides.journalRepository ?? createJournalRepository(),
    alertRepository: overrides.alertRepository ?? createAlertRepository(),
    scannerRepository: overrides.scannerRepository ?? createScannerRepository(),
  }
}

function getPnlRows(orders, journals) {
  const journalRows = journals.filter((entry) => entry?.pnl !== undefined)
  const orderRows = orders
    .filter((order) => order?.pnl !== undefined)
    .map((order) => ({ pnl: order.pnl, createdAt: order.createdAt, symbol: order.symbol }))

  return [...journalRows, ...orderRows]
}

function buildQuoteMap(quotes = [], activeQuote) {
  const quoteMap = {}
  for (const quote of quotes) {
    if (quote?.symbol) quoteMap[quote.symbol] = quote
  }
  if (activeQuote?.symbol) quoteMap[activeQuote.symbol] = activeQuote
  return quoteMap
}

function normalizeJournalEntry(entry) {
  return {
    id: entry.id ?? entry.journalId,
    symbol: entry.symbol ?? 'SPY',
    strategy: entry.strategy ?? entry.thesis ?? 'Systematic',
    emotion: entry.emotion ?? 'calm',
    notes: entry.notes ?? entry.message ?? entry.thesis ?? '',
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    result: entry.result ?? (numberValue(entry.pnl) > 0 ? 'win' : numberValue(entry.pnl) < 0 ? 'loss' : 'neutral'),
    duration: entry.duration ?? 'n/a',
    pnl: entry.pnl,
    createdAt: entry.createdAt ?? Date.now(),
  }
}

export function createWorkspaceDataService({
  marketDataService = defaultMarketDataService,
  orderRepository,
  portfolioRepository,
  journalRepository,
  alertRepository,
  scannerRepository,
  eventLogger = tradingEventLogger,
  regimeOrchestrator = defaultRegimeOrchestrator,
  indicatorPipeline,
} = {}) {
  const repositories = getRepositories({ orderRepository, portfolioRepository, journalRepository, alertRepository, scannerRepository })
  const scannerEvaluator = createScannerEvaluator({ marketDataService, signalEngine, riskEngine })
  const paperBroker = createPaperBroker({
    orderRepository: repositories.orderRepository,
    portfolioRepository: repositories.portfolioRepository,
    journalRepository: repositories.journalRepository,
    eventLogger,
  })
  const dailyIndicatorPipeline = indicatorPipeline ?? createDailyIndicatorPipeline({ marketDataService })

  // Initialize journal engine with event listeners.
  createJournalEngine({ journalRepository: repositories.journalRepository })

  // Listen for order events and emit portfolio:updated
  eventBus.subscribe('order:created', () => {
    eventBus.emit('portfolio:updated', { source: 'order:created' })
  })

  eventBus.subscribe('order:updated', () => {
    eventBus.emit('portfolio:updated', { source: 'order:updated' })
  })

  eventBus.subscribe('order:cancelled', () => {
    eventBus.emit('portfolio:updated', { source: 'order:cancelled' })
  })

  return {
    async getWatchlist() {
      const quotes = await marketDataService.getWatchlistQuotes()
      return {
        paperTrading: true,
        quotes,
        marketData: combineMarketDataProvenance(quotes.map((quote) => quote.provenance)),
      }
    },

    async getMarketOverview(symbol, { timeframe = '1D', now, includeHistoricalIntelligence = false } = {}) {
      if (!includeHistoricalIntelligence) {
        const quote = await marketDataService.getQuote(symbol)
        const regime = regimeOrchestrator.classify({
          symbol,
          timeframe,
          marketData: quote.provenance,
          observations: {
            price: {
              value: quote.price,
              source: quote.provider,
              symbol: quote.symbol,
              timeframe: 'REALTIME',
              observedAt: quote.updatedAt,
              receivedAt: new Date().toISOString(),
              derivation: 'provider-supplied',
            },
          },
        }, { now })
        return { paperTrading: true, symbol, quote, regime }
      }
      const [quote, indicatorBundle] = await Promise.all([
        marketDataService.getQuote(symbol),
        dailyIndicatorPipeline.build({ symbol, timeframe }, { now, calculatedAt: now }),
      ])
      const regime = regimeOrchestrator.classify({
        symbol,
        timeframe,
        marketData: quote.provenance,
        indicatorBundle,
        observations: {
          price: {
            value: quote.price,
            source: quote.provider,
            symbol: quote.symbol,
            timeframe: 'REALTIME',
            observedAt: quote.updatedAt,
            receivedAt: new Date().toISOString(),
            derivation: 'provider-supplied',
          },
        },
      }, { now })
      return {
        paperTrading: true,
        symbol,
        quote,
        regime,
      }
    },

    async getStrategySuitability(symbol, { timeframe = '1D', now } = {}) {
      const marketOverview = await this.getMarketOverview(symbol, {
        timeframe,
        now,
        includeHistoricalIntelligence: true,
      })
      return {
        paperTrading: true,
        advisoryOnly: true,
        symbol,
        suitability: selectStrategiesForRegime({
          regime: marketOverview.regime,
          strategies: EXISTING_ADAPTIVE_STRATEGY_RECORDS,
          context: { symbol, timeframe },
        }, { logger: serverLogger }),
      }
    },

    async getTradeQuality(candidate, { timeframe = '1D', now } = {}) {
      const marketOverview = await this.getMarketOverview(candidate.symbol, {
        timeframe,
        now,
        includeHistoricalIntelligence: true,
      })
      const suitability = selectStrategiesForRegime({
        regime: marketOverview.regime,
        strategies: EXISTING_ADAPTIVE_STRATEGY_RECORDS,
        context: { symbol: candidate.symbol, timeframe },
      }, { logger: serverLogger })
      return {
        paperTrading: true,
        advisoryOnly: true,
        quality: scoreTradeQuality({
          candidate,
          regime: marketOverview.regime,
          strategySuitability: suitability,
        }, { logger: serverLogger }),
      }
    },

    async getDailyBriefing(symbol = 'SPY', { timeframe = '1D', now, reviewedOpportunities = [], durablePaperState } = {}) {
      const [marketOverview, portfolioResult, alertResult] = await Promise.all([
        this.getMarketOverview(symbol, { timeframe, now, includeHistoricalIntelligence: true }),
        durablePaperState?.portfolioResult ? Promise.resolve(durablePaperState.portfolioResult) : this.getPortfolioSummary(),
        durablePaperState?.alerts ? Promise.resolve({ alerts: durablePaperState.alerts }) : this.listAlerts(),
      ])
      const suitability = selectStrategiesForRegime({
        regime: marketOverview.regime,
        strategies: EXISTING_ADAPTIVE_STRATEGY_RECORDS,
        context: { symbol, timeframe },
      }, { logger: serverLogger })
      const quoteHealth = marketOverview.quote?.health ?? {}
      const marketData = marketOverview.quote?.provenance
      return {
        paperTrading: true,
        advisoryOnly: true,
        briefing: buildDailyBriefing({
          regime: marketOverview.regime,
          strategySuitability: suitability,
          opportunities: reviewedOpportunities,
          portfolioRisk: portfolioResult,
          alerts: alertResult.alerts,
          operations: {
            status: marketData?.dataStatus === 'LIVE' ? 'HEALTHY' : marketData?.dataStatus ?? (quoteHealth.available === false ? 'DEGRADED' : 'UNKNOWN'),
            provider: marketData?.provider ?? quoteHealth.provider ?? marketOverview.quote?.provider ?? 'unknown',
            providerStatus: marketData?.dataStatus ?? (quoteHealth.available === false ? 'DEGRADED' : 'UNKNOWN'),
            marketData,
          },
        }, { logger: serverLogger }),
      }
    },

    async runPaperEvaluation({ symbol = 'SPY', timeframe = '1D', candidates = [], existingEvaluations = [], now } = {}) {
      const [marketOverview, portfolioResult] = await Promise.all([
        this.getMarketOverview(symbol, { timeframe, now, includeHistoricalIntelligence: true }),
        this.getPortfolioSummary(),
      ])
      const suitability = selectStrategiesForRegime({ regime: marketOverview.regime, strategies: EXISTING_ADAPTIVE_STRATEGY_RECORDS, context: { symbol, timeframe } }, { logger: serverLogger })
      return { paperTrading: true, advisoryOnly: true, automaticExecution: false, evaluations: evaluatePaperCandidates({ candidates, regime: marketOverview.regime, strategySuitability: suitability, portfolioRisk: portfolioResult.summary, existingEvaluations }, { now }) }
    },

    async getSignal(symbol) {
      const quote = await marketDataService.getQuote(symbol)
      return {
        paperTrading: true,
        symbol,
        signal: signalEngine.evaluateQuote(quote),
      }
    },

    async getRiskSummary(symbol) {
      const quote = await marketDataService.getQuote(symbol)
      const portfolio = repositories.portfolioRepository.list()[0] ?? { cash: 100000, exposure: 0.1 }
      const price = numberValue(quote.price)
      const accountValue = numberValue(portfolio.accountValue ?? portfolio.cash, 100000)
      const stopDistance = Number((price * 0.02).toFixed(2))
      const positionSize = Math.max(1, Math.floor(positionSizingEngine.sizeOrder({
        accountBalance: accountValue,
        riskPerTrade: 0.01,
        price,
        stopDistance,
      })))
      const order = {
        symbol,
        type: 'LIMIT',
        side: 'BUY',
        quantity: positionSize,
        price,
      }
      const decision = riskEngine.evaluateOrder(order, portfolio, quote)
      const notional = positionSize * price

      return {
        paperTrading: true,
        symbol,
        risk: {
          ...decision,
          symbol,
          positionSize: decision.approved ? positionSize : 0,
          requestedPositionSize: positionSize,
          accountValue,
          maxRiskPerTrade: 1,
          stopDistance,
          stopPrice: Number((price - stopDistance).toFixed(2)),
          targetPrice: Number((price + (stopDistance * 2)).toFixed(2)),
          rewardRatio: 2,
          dollarRisk: Number((positionSize * stopDistance).toFixed(2)),
          accountExposure: accountValue > 0 ? Number(((notional / accountValue) * 100).toFixed(2)) : 0,
          dailyExposure: 0,
          portfolioRisk: Number((numberValue(portfolio.exposure) * 100).toFixed(2)),
          buyingPowerImpact: accountValue > 0 ? Number(((notional / accountValue) * 100).toFixed(2)) : 0,
          warning: decision.approved ? null : decision.reason,
        },
      }
    },

    async getDecision(symbol) {
      const quote = await marketDataService.getQuote(symbol)
      const signal = signalEngine.evaluateQuote(quote)
      const riskSummary = await this.getRiskSummary(symbol)
      const portfolioSummary = await this.getPortfolioSummary()
      const watchlist = await marketDataService.getWatchlistQuotes()
      const activeQuote = watchlist.find((entry) => entry.symbol === symbol) ?? quote
      const positionsResult = await this.getPositions({
        quotes: watchlist,
        activeQuote,
        accountValue: portfolioSummary.summary.accountValue,
      })
      const scannerMatches = await scannerEvaluator.evaluate(repositories.scannerRepository.list())
      const assetProfile = resolveOrderAsset({
        symbol,
        assetType: quote.assetType,
        quantity: riskSummary.risk.requestedPositionSize,
        price: quote.price,
      }, quote)
      const decision = decisionEngine.evaluate({
        quote,
        signal,
        risk: riskSummary.risk,
        scannerMatches: scannerMatches.filter((match) => match.symbol === symbol),
        portfolio: portfolioSummary.summary,
        positions: positionsResult.positions,
        assetProfile,
      })

      return {
        paperTrading: true,
        symbol,
        assetProfile: {
          assetType: assetProfile.assetType,
          quantityLabel: assetProfile.quantityLabel,
          pricePrecision: assetProfile.pricePrecision,
          tickSize: assetProfile.tickSize,
          tradingSession: assetProfile.tradingSession,
        },
        decision,
      }
    },

    async getPortfolioSummary() {
      const portfolio = repositories.portfolioRepository.list()[0] ?? { cash: 100000, exposure: 0.1 }
      const orders = repositories.orderRepository.list()
      const store = getStore()
      const pnlRows = getPnlRows(orders, store.journals)
      const performance = performanceEngine.summarize(pnlRows)
      const fills = orders
        .filter((order) => order.state === 'FILLED')
        .map((order) => ({
          symbol: order.symbol,
          side: order.side,
          quantity: order.quantity,
          fillPrice: order.filledPrice ?? order.price,
          avgCost: order.avgCost,
        }))
      const portfolioState = portfolioEngine.buildState({
        cash: numberValue(portfolio.cash, 100000),
        fills,
      })
      const pnlValues = pnlRows.map((row) => numberValue(row.pnl))
      const equitySeries = pnlValues.reduce((series, pnl) => {
        series.push(Number((series[series.length - 1] + pnl).toFixed(2)))
        return series
      }, [numberValue(portfolioState.equity, 100000)])
      const winners = pnlValues.filter((value) => value > 0)
      const losers = pnlValues.filter((value) => value < 0)
      const realizedPnl = numberValue(performance.realizedPnl)
      const startingEquity = equitySeries[0] || 100000
      const accountValue = Number((numberValue(portfolioState.equity, startingEquity) + realizedPnl).toFixed(2))

      return {
        paperTrading: true,
        summary: {
          accountValue,
          cash: numberValue(portfolioState.cash, 100000),
          buyingPower: numberValue(portfolioState.buyingPower, 100000),
          dailyReturn: startingEquity > 0 && pnlValues.length > 0 ? (pnlValues[pnlValues.length - 1] / startingEquity) * 100 : 0,
          totalReturn: startingEquity > 0 ? ((accountValue - startingEquity) / startingEquity) * 100 : 0,
          winRate: performance.winRate * 100,
          averageWinner: performance.averageWin,
          averageLoser: performance.averageLoss,
          profitFactor: performance.profitFactor === Infinity ? 999 : performance.profitFactor,
          sharpeRatio: pnlValues.length === 0 ? 0 : Number((realizedPnl / Math.max(1, Math.abs(performance.averageLoss || 1))).toFixed(2)),
          maxDrawdown: equityCurveEngine.calculateMaxDrawdown(equitySeries),
          expectancy: performance.tradeCount === 0 ? 0 : realizedPnl / performance.tradeCount,
          largestWinner: winners.length === 0 ? 0 : Math.max(...winners),
          largestLoser: losers.length === 0 ? 0 : Math.min(...losers),
          openRisk: getStore().risks.reduce((total, risk) => total + numberValue(risk.dollarRisk), 0),
        },
      }
    },

    async getEquityCurve() {
      const portfolio = repositories.portfolioRepository.list()[0] ?? { cash: 100000 }
      const store = getStore()
      const rows = getPnlRows(repositories.orderRepository.list(), store.journals)
        .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())
      const startEquity = numberValue(portfolio.cash, 100000)
      let runningEquity = startEquity
      let peak = startEquity
      const points = rows.map((row, index) => {
        runningEquity = Number((runningEquity + numberValue(row.pnl)).toFixed(2))
        peak = Math.max(peak, runningEquity)
        const drawdown = peak === 0 ? 0 : Number((((peak - runningEquity) / peak) * 100).toFixed(2))
        return {
          index,
          label: row.symbol ?? row.strategy ?? 'Portfolio',
          value: runningEquity,
          pnl: numberValue(row.pnl),
          createdAt: row.createdAt,
          drawdown,
        }
      })

      return {
        paperTrading: true,
        points,
        drawdowns: points.map((point) => ({ index: point.index, value: point.drawdown })),
        timeline: points,
        maxDrawdown: equityCurveEngine.calculateMaxDrawdown(points.map((point) => point.value)),
      }
    },

    async getJournalSummary({ search = '', symbol = 'all', result = 'all' } = {}) {
      const entries = getStore().journals.map(normalizeJournalEntry)
      const normalizedSearch = String(search).trim().toLowerCase()
      const filteredEntries = entries.filter((entry) => {
        const matchesSearch = normalizedSearch.length === 0
          || entry.notes.toLowerCase().includes(normalizedSearch)
          || entry.strategy.toLowerCase().includes(normalizedSearch)
          || entry.tags.join(' ').toLowerCase().includes(normalizedSearch)
        const matchesSymbol = symbol === 'all' || entry.symbol === symbol
        const matchesResult = result === 'all' || entry.result === result

        return matchesSearch && matchesSymbol && matchesResult
      })

      return {
        paperTrading: true,
        entries: filteredEntries,
        symbols: [...new Set(entries.map((entry) => entry.symbol).filter(Boolean))].sort(),
      }
    },

    async getOrders() {
      return {
        paperTrading: true,
        orders: repositories.orderRepository.list(),
      }
    },

    async getPositions({ quotes = [], activeQuote = null, accountValue = 100000 } = {}) {
      const filledOrders = repositories.orderRepository.list().filter((order) => order.state === 'FILLED')
      const positionMap = filledOrders.reduce((current, order) => {
        return positionEngine.applyFill(current, {
          ...order,
          fillPrice: numberValue(order.filledPrice ?? order.price),
        })
      }, {})
      const quoteMap = buildQuoteMap(quotes, activeQuote)
      const totalValue = numberValue(accountValue, 100000)
      const positions = Object.values(positionMap)
        .filter((position) => numberValue(position.quantity) > 0)
        .map((position) => {
          const quote = quoteMap[position.symbol] ?? {}
          const currentPrice = numberValue(quote.price ?? position.averageCost)
          const marketValue = Number((numberValue(position.quantity) * currentPrice).toFixed(2))
          const costBasis = numberValue(position.quantity) * numberValue(position.averageCost)
          const unrealizedPnl = Number((marketValue - costBasis).toFixed(2))

          return {
            symbol: position.symbol,
            quantity: numberValue(position.quantity),
            averageCost: numberValue(position.averageCost),
            currentPrice,
            marketValue,
            unrealizedPnl,
            realizedPnl: 0,
            dailyReturn: numberValue(quote.changePercent),
            riskPct: totalValue > 0 ? Number(((Math.abs(unrealizedPnl) / totalValue) * 100).toFixed(2)) : 0,
            weight: totalValue > 0 ? Number(((marketValue / totalValue) * 100).toFixed(2)) : 0,
          }
        })

      return {
        paperTrading: true,
        positions,
      }
    },

    async listAlerts() {
      return {
        paperTrading: true,
        alerts: repositories.alertRepository.list(),
      }
    },

    async createAlert(payload = {}) {
      const validation = validateAlertPayload(payload)
      if (!validation.ok) {
        return {
          ok: false,
          statusCode: 400,
          error: validation.error,
        }
      }

      return {
        paperTrading: true,
        alert: repositories.alertRepository.create(validation.alert),
      }
    },

    async updateAlert(id, payload = {}) {
      const existing = repositories.alertRepository.find(String(id ?? '').trim())
      if (!existing) {
        return {
          ok: false,
          statusCode: 404,
          error: {
            code: 'alert_not_found',
            message: 'alert was not found',
          },
        }
      }

      const validation = validateAlertPayload({ ...existing, ...payload })
      if (!validation.ok) {
        return {
          ok: false,
          statusCode: 400,
          error: validation.error,
        }
      }

      return {
        paperTrading: true,
        alert: repositories.alertRepository.update(existing.id, () => validation.alert),
      }
    },

    async deleteAlert(id) {
      const normalizedId = String(id ?? '').trim()
      if (!normalizedId) {
        return {
          ok: false,
          statusCode: 400,
          error: {
            code: 'missing_alert_id',
            message: 'alert id is required',
          },
        }
      }

      return {
        paperTrading: true,
        deleted: repositories.alertRepository.delete(normalizedId),
      }
    },

    async evaluateAlerts(context = {}, alertsOverride, portfolioOverride) {
      const alerts = alertsOverride ?? repositories.alertRepository.list()
      const watchlistQuotes = await marketDataService.getWatchlistQuotes()
      const quoteMap = Object.fromEntries(watchlistQuotes.map((quote) => [quote.symbol, quote]))
      const signalMap = Object.fromEntries(watchlistQuotes.map((quote) => [quote.symbol, signalEngine.evaluateQuote(quote)]))
      const portfolio = portfolioOverride ? { summary: portfolioOverride } : await this.getPortfolioSummary()
      const triggeredAlerts = alertEvaluator.evaluate(alerts, {
        quotes: { ...quoteMap, ...(context.quotes ?? {}) },
        signals: { ...signalMap, ...(context.signals ?? {}) },
        risks: context.risks ?? {},
        portfolio: context.portfolio ?? portfolio.summary,
      })

      return {
        paperTrading: true,
        triggeredAlerts,
      }
    },

    async listScanners() {
      return {
        paperTrading: true,
        scanners: repositories.scannerRepository.list(),
      }
    },

    async createScanner(payload = {}) {
      const validation = validateScannerPayload(payload)
      if (!validation.ok) {
        return { ok: false, statusCode: 400, error: validation.error }
      }

      return {
        paperTrading: true,
        scanner: repositories.scannerRepository.create(validation.scanner),
      }
    },

    async updateScanner(id, payload = {}) {
      const existing = repositories.scannerRepository.find(String(id ?? '').trim())
      if (!existing) {
        return {
          ok: false,
          statusCode: 404,
          error: {
            code: 'scanner_not_found',
            message: 'scanner was not found',
          },
        }
      }

      const validation = validateScannerPayload({ ...existing, ...payload })
      if (!validation.ok) {
        return { ok: false, statusCode: 400, error: validation.error }
      }

      return {
        paperTrading: true,
        scanner: repositories.scannerRepository.update(existing.id, () => validation.scanner),
      }
    },

    async deleteScanner(id) {
      const normalizedId = String(id ?? '').trim()
      if (!normalizedId) {
        return {
          ok: false,
          statusCode: 400,
          error: {
            code: 'missing_scanner_id',
            message: 'scanner id is required',
          },
        }
      }

      return {
        paperTrading: true,
        deleted: repositories.scannerRepository.delete(normalizedId),
      }
    },

    async evaluateScanners() {
      return {
        paperTrading: true,
        matches: await scannerEvaluator.evaluate(repositories.scannerRepository.list()),
      }
    },

    async submitPaperOrder(payload = {}, { requestId } = {}) {
      if (payload.paperTrading === false) {
        return {
          ok: false,
          statusCode: 400,
          error: {
            code: 'paper_trading_required',
            message: 'paper trading mode is required',
          },
        }
      }

      const orderPayload = {
        symbol: payload.symbol,
        assetType: payload.assetType,
        type: payload.type,
        side: payload.side,
        quantity: Number(payload.quantity),
        price: Number(payload.price),
        limitPrice: Number(payload.limitPrice ?? payload.price ?? 0),
        stopPrice: Number(payload.stopPrice ?? 0),
        riskPct: Number(payload.riskPct ?? 0),
        timeInForce: payload.timeInForce ?? 'DAY',
      }
      const validationError = validateOrderPayload(orderPayload)
      if (!validationError.ok) {
        return {
          ok: false,
          statusCode: 400,
          error: {
            code: validationError.error.code,
            message: validationError.error.message,
          },
        }
      }

      if ((orderPayload.type === 'LIMIT' || orderPayload.type === 'STOP_LIMIT') && orderPayload.limitPrice <= 0) {
        return {
          ok: false,
          statusCode: 400,
          error: {
            code: 'invalid_limit_price',
            message: 'limit price must be greater than zero',
          },
        }
      }

      if ((orderPayload.type === 'STOP' || orderPayload.type === 'STOP_LIMIT') && orderPayload.stopPrice <= 0) {
        return {
          ok: false,
          statusCode: 400,
          error: {
            code: 'invalid_stop_price',
            message: 'stop price must be greater than zero',
          },
        }
      }

      const quote = {
        symbol: orderPayload.symbol,
        price: Number(payload.quote?.price ?? orderPayload.price),
        updatedAt: payload.quote?.updatedAt ?? new Date().toISOString(),
      }
      const portfolio = repositories.portfolioRepository.list()[0] ?? { id: 'portfolio-1', cash: 100000, exposure: 0.1 }
      const result = paperBroker.submitOrder(orderPayload, quote, portfolio, { requestId })

      if (result?.error) {
        eventLogger.log(TRADING_EVENTS.ORDER_REJECTED, {
          requestId,
          symbol: orderPayload.symbol,
          side: orderPayload.side,
          type: orderPayload.type,
          reason: result.error.message,
        })
        return {
          ok: false,
          statusCode: 400,
          error: {
            code: result.error.code ?? 'order_rejected',
            message: result.error.message ?? 'paper order rejected',
          },
        }
      }

      eventLogger.log(TRADING_EVENTS.ORDER_SUBMITTED, {
        requestId,
        orderId: result.order.id,
        symbol: result.order.symbol,
        side: result.order.side,
        type: result.order.type,
        state: result.order.state,
      })
      return {
        paperTrading: true,
        order: result.order,
      }
    },

    async cancelPaperOrder(orderId, { requestId } = {}) {
      const normalizedId = String(orderId ?? '').trim()
      if (!normalizedId) {
        return {
          ok: false,
          statusCode: 400,
          error: {
            code: 'missing_order_id',
            message: 'order id is required',
          },
        }
      }

      const order = repositories.orderRepository.find(normalizedId)
      if (!order) {
        return {
          ok: false,
          statusCode: 404,
          error: {
            code: 'order_not_found',
            message: 'order was not found',
          },
        }
      }

      if (isTerminalState(order.state)) {
        return {
          ok: false,
          statusCode: 400,
          error: {
            code: 'order_not_cancellable',
            message: 'order cannot be cancelled',
          },
        }
      }

      const canceled = paperBroker.cancelOrder(normalizedId)
      if (!canceled) {
        return {
          ok: false,
          statusCode: 400,
          error: {
            code: 'cancel_failed',
            message: 'order could not be cancelled',
          },
        }
      }

      eventLogger.log(TRADING_EVENTS.ORDER_CANCELLED, {
        requestId,
        orderId: canceled.id,
        symbol: canceled.symbol,
      })
      return {
        paperTrading: true,
        order: canceled,
      }
    },
  }
}
