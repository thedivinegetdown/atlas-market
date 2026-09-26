import { evaluateIndexPullbackExitPolicy } from '../forwardTest/indexPullbackExitPolicy.js'
import { evaluateBreakoutMomentumExitPolicy } from '../forwardTest/breakoutMomentumExitPolicy.js'
import { evaluateRangeMeanReversionExitPolicy } from '../forwardTest/rangeMeanReversionExitPolicy.js'
import { evaluateVolatilityExpansionExitPolicy } from '../forwardTest/volatilityExpansionExitPolicy.js'

// Frozen policy implementations remain the only threshold/price authority.
export const exitPolicyEvaluators = Object.freeze({
  'index-pullback-exit-v1.0.0': evaluateIndexPullbackExitPolicy,
  'breakout-momentum-exit-v1.0.0': evaluateBreakoutMomentumExitPolicy,
  'range-mean-reversion-exit-v1.0.0': evaluateRangeMeanReversionExitPolicy,
  'volatility-expansion-exit-v1.0.0': evaluateVolatilityExpansionExitPolicy,
})
