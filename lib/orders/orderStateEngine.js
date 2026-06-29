const ORDER_STATES = Object.freeze({
  NEW: 'NEW',
  WORKING: 'WORKING',
  PARTIALLY_FILLED: 'PARTIALLY_FILLED',
  FILLED: 'FILLED',
  CANCELED: 'CANCELED',
  REJECTED: 'REJECTED',
})

const TERMINAL_STATES = new Set([ORDER_STATES.FILLED, ORDER_STATES.CANCELED, ORDER_STATES.REJECTED])

export function getOrderStates() {
  return ORDER_STATES
}

export function isTerminalState(state) {
  return TERMINAL_STATES.has(state)
}

export function canTransition(currentState, nextState) {
  if (currentState === nextState) {
    return false
  }

  const allowedTransitions = {
    [ORDER_STATES.NEW]: [ORDER_STATES.WORKING, ORDER_STATES.REJECTED, ORDER_STATES.CANCELED],
    [ORDER_STATES.WORKING]: [ORDER_STATES.PARTIALLY_FILLED, ORDER_STATES.FILLED, ORDER_STATES.CANCELED],
    [ORDER_STATES.PARTIALLY_FILLED]: [ORDER_STATES.FILLED, ORDER_STATES.CANCELED],
    [ORDER_STATES.FILLED]: [],
    [ORDER_STATES.CANCELED]: [],
    [ORDER_STATES.REJECTED]: [],
  }

  return allowedTransitions[currentState]?.includes(nextState) ?? false
}

export function transitionOrderState(order, nextState) {
  if (!canTransition(order.state, nextState)) {
    return null
  }

  return {
    ...order,
    state: nextState,
    updatedAt: Date.now(),
  }
}
