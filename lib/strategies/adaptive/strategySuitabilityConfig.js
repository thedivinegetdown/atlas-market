export const DEFAULT_STRATEGY_SUITABILITY_CONFIG = Object.freeze({
  preferredConfidence: 70,
  minimumConfidence: 50,
  missingInputPenalty: 10,
  partialRegimePenalty: 15,
  validatedLifecyclePenalty: 10,
  strategies: Object.freeze({
    'index-pullback-v1': Object.freeze({
      trend: Object.freeze({
        enabled: Object.freeze(['BULL', 'RANGE']),
        conditional: Object.freeze(['STRONG_BULL', 'BEAR']),
      }),
      volatility: Object.freeze({
        enabled: Object.freeze(['NORMAL_VOLATILITY', 'LOW_VOLATILITY']),
        conditional: Object.freeze(['HIGH_VOLATILITY']),
      }),
      risk: Object.freeze({
        enabled: Object.freeze(['RISK_ON']),
        conditional: Object.freeze(['NEUTRAL']),
      }),
      requiredIndicators: Object.freeze([]),
    }),
    'breakout-momentum-v1': Object.freeze({
      trend: Object.freeze({ enabled: Object.freeze(['STRONG_BULL', 'BULL']), conditional: Object.freeze(['RANGE']) }),
      volatility: Object.freeze({ enabled: Object.freeze(['NORMAL_VOLATILITY', 'LOW_VOLATILITY']), conditional: Object.freeze(['HIGH_VOLATILITY']) }),
      risk: Object.freeze({ enabled: Object.freeze(['RISK_ON']), conditional: Object.freeze(['NEUTRAL']) }),
      requiredIndicators: Object.freeze([]),
    }),
  }),
})

export const EXISTING_ADAPTIVE_STRATEGY_RECORDS = Object.freeze([
  Object.freeze({
    strategyId: 'index-pullback-v1',
    strategyName: 'Index Pullback',
    versionReference: '1.2.0',
    status: 'paper_forward_observation',
    lifecycleState: 'paper_forward_observation',
    validationStatus: 'valid',
    activationEligibilityStatus: 'paper_observation',
    timeframeReferences: Object.freeze(['swing', 'position']),
    compatibleAssetClasses: Object.freeze(['etf', 'equity']),
    paperTrading: true,
    paperForwardObservationApproved: true,
    liveTradingApproved: false,
  }),
  Object.freeze({
    strategyId: 'breakout-momentum-v1', strategyName: 'Breakout Momentum', versionReference: '1.0.0',
    status: 'paper_forward_observation', lifecycleState: 'paper_forward_observation', validationStatus: 'valid',
    activationEligibilityStatus: 'paper_observation', timeframeReferences: Object.freeze(['swing']),
    compatibleAssetClasses: Object.freeze(['etf', 'equity']), paperTrading: true,
    paperForwardObservationApproved: true, liveTradingApproved: false,
  }),
])
