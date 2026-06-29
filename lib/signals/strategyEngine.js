export function determineAction(score, riskFlags = []) {
  if (riskFlags.includes('weak-setup') || riskFlags.includes('low-volume')) {
    return 'AVOID'
  }

  if (score >= 70) {
    return 'BUY'
  }

  if (score <= 35) {
    return 'AVOID'
  }

  return 'HOLD'
}

export function buildThesis(action, factors) {
  if (action === 'BUY') {
    return `Momentum and trend support a constructive outlook based on ${factors.join(', ')}.`
  }

  if (action === 'AVOID') {
    return `The current conditions suggest caution due to ${factors.join(', ')}.`
  }

  return `The setup is balanced and warrants monitoring based on ${factors.join(', ')}.`
}
