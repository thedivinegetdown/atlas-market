import { getSymbolMetadata } from '../assets/index.js'
import { createMarketDataService } from '../market/marketDataService.js'
import { createRiskEngine } from '../risk/riskEngine.js'
import { createSignalEngine } from '../signals/signalEngine.js'
import { SCANNER_CRITERIA } from './scannerCriteria.js'

function numberValue(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

function getCriterionValue(criterion, quote, signal, risk) {
  switch (criterion.type) {
    case SCANNER_CRITERIA.PRICE_ABOVE:
    case SCANNER_CRITERIA.PRICE_BELOW:
      return numberValue(quote.price)
    case SCANNER_CRITERIA.PERCENT_CHANGE_ABOVE:
    case SCANNER_CRITERIA.PERCENT_CHANGE_BELOW:
      return numberValue(quote.changePercent)
    case SCANNER_CRITERIA.VOLUME_ABOVE:
      return numberValue(quote.volume)
    case SCANNER_CRITERIA.SIGNAL_BULLISH:
    case SCANNER_CRITERIA.SIGNAL_BEARISH:
      return String(signal.action ?? '').toUpperCase()
    case SCANNER_CRITERIA.VOLATILITY_ABOVE:
      return numberValue(quote.volatility ?? Math.abs(numberValue(quote.changePercent)))
    case SCANNER_CRITERIA.RISK_ACCEPTABLE:
      return Boolean(risk.approved)
    default:
      return null
  }
}

function criterionMatches(criterion, value) {
  switch (criterion.type) {
    case SCANNER_CRITERIA.PRICE_ABOVE:
      return numberValue(value) > numberValue(criterion.threshold)
    case SCANNER_CRITERIA.PRICE_BELOW:
      return numberValue(value) < numberValue(criterion.threshold)
    case SCANNER_CRITERIA.PERCENT_CHANGE_ABOVE:
      return numberValue(value) > numberValue(criterion.threshold)
    case SCANNER_CRITERIA.PERCENT_CHANGE_BELOW:
      return numberValue(value) < numberValue(criterion.threshold)
    case SCANNER_CRITERIA.VOLUME_ABOVE:
      return numberValue(value) > numberValue(criterion.threshold)
    case SCANNER_CRITERIA.SIGNAL_BULLISH:
      return ['BUY', 'STRONG_BUY'].includes(String(value).toUpperCase())
    case SCANNER_CRITERIA.SIGNAL_BEARISH:
      return ['SELL', 'AVOID'].includes(String(value).toUpperCase())
    case SCANNER_CRITERIA.VOLATILITY_ABOVE:
      return numberValue(value) > numberValue(criterion.threshold)
    case SCANNER_CRITERIA.RISK_ACCEPTABLE:
      return value === true
    default:
      return false
  }
}

export function createScannerEvaluator({
  marketDataService = createMarketDataService(),
  signalEngine = createSignalEngine(),
  riskEngine = createRiskEngine(),
  now = () => new Date().toISOString(),
} = {}) {
  return {
    async evaluate(scanners = []) {
      const enabledScanners = scanners.filter((scanner) => scanner.enabled !== false)
      const results = []

      for (const scanner of enabledScanners) {
        const quotes = await marketDataService.getQuotes(scanner.symbols, { assetType: scanner.assetType })
        for (const quote of quotes) {
          const metadata = getSymbolMetadata(quote.symbol, scanner.assetType)
          const signal = signalEngine.evaluateQuote(quote)
          const risk = riskEngine.evaluateOrder({
            symbol: quote.symbol,
            assetType: metadata.assetType,
            side: 'BUY',
            type: 'LIMIT',
            quantity: 1,
            price: numberValue(quote.price),
          }, { exposure: 0.1 }, quote)
          const matchedCriteria = []
          const currentValues = {}

          for (const criterion of scanner.criteria) {
            const value = getCriterionValue(criterion, quote, signal, risk)
            currentValues[criterion.type] = value
            if (criterionMatches(criterion, value)) {
              matchedCriteria.push(criterion.type)
            }
          }

          if (matchedCriteria.length === scanner.criteria.length) {
            results.push({
              scannerId: scanner.id,
              scannerName: scanner.name,
              symbol: quote.symbol,
              assetType: metadata.assetType,
              matchedCriteria,
              currentValues,
              evaluatedAt: now(),
            })
          }
        }
      }

      return results
    },
  }
}
