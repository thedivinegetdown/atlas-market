export const DECISION_ACTIONS = Object.freeze({
  STRONG_BUY: 'strong_buy',
  BUY: 'buy',
  WATCH: 'watch',
  NEUTRAL: 'neutral',
  REDUCE: 'reduce',
  SELL: 'sell',
  STRONG_SELL: 'strong_sell',
  AVOID: 'avoid',
})

export function formatDecisionLabel(action) {
  return String(action ?? DECISION_ACTIONS.NEUTRAL)
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}
