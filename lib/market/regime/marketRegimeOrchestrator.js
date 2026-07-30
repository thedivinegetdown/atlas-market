import { classifyMarketRegime } from './marketRegimeEngine.js'
import { buildRegimeInput } from './buildRegimeInput.js'
import { createRegimeReadModel } from './regimeReadModel.js'
import { normalizeRegimeTimeframe } from './validateRegimeTimeframes.js'

export function createMarketRegimeOrchestrator({ classifier = classifyMarketRegime, logger } = {}) {
  return {
    classify(context = {}, options = {}) {
      const timeframe = normalizeRegimeTimeframe(context.timeframe ?? '1D')
      const builtInput = buildRegimeInput({ ...context, timeframe }, options)
      const classification = classifier(builtInput.metrics, options.engineOptions)
      const result = createRegimeReadModel({ symbol: context.symbol, timeframe, classification, builtInput })
      logger?.info?.('market regime orchestration completed', {
        symbol: result.symbol,
        timeframe: result.timeframe,
        status: result.classification.status,
        confidence: result.classification.confidence,
        missingInputCount: result.inputCoverage.missing.length,
        engineVersion: result.engineVersion,
      })
      return result
    },
  }
}

export const marketRegimeOrchestrator = createMarketRegimeOrchestrator()
