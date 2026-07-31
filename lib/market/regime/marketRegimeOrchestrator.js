import { classifyMarketRegime } from './marketRegimeEngine.js'
import { buildRegimeInput } from './buildRegimeInput.js'
import { createRegimeReadModel } from './regimeReadModel.js'
import { normalizeRegimeTimeframe } from './validateRegimeTimeframes.js'

export function createMarketRegimeOrchestrator({ classifier = classifyMarketRegime, logger } = {}) {
  return {
    classify(context = {}, options = {}) {
      const timeframe = normalizeRegimeTimeframe(context.timeframe ?? '1D')
      const bundleObservations = Object.fromEntries(Object.entries(context.indicatorBundle?.indicators ?? {}).map(([name, value]) => {
        const source = context.indicatorBundle?.provenance?.[name] ?? {}
        return [name, {
          value,
          source: source.source,
          symbol: source.symbol,
          timeframe: source.timeframe ?? context.indicatorBundle?.timeframe,
          observedAt: source.observedAt ?? context.indicatorBundle?.asOf,
          receivedAt: source.calculatedAt,
          derivation: source.derivation ?? 'calculated',
        }]
      }))
      const builtInput = buildRegimeInput({
        ...context,
        timeframe,
        observations: { ...bundleObservations, ...context.observations },
      }, options)
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
