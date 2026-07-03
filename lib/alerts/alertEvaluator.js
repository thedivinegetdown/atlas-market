import { ALERT_TYPES } from './alertTypes.js'

function numberValue(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

function getCurrentValue(alert, context) {
  const quote = context.quotes?.[alert.symbol] ?? context.quote
  const signal = context.signals?.[alert.symbol] ?? context.signal
  const risk = context.risks?.[alert.symbol] ?? context.risk
  const portfolio = context.portfolio ?? {}

  switch (alert.alertType) {
    case ALERT_TYPES.PRICE_ABOVE:
    case ALERT_TYPES.PRICE_BELOW:
      return numberValue(quote?.price)
    case ALERT_TYPES.PERCENT_CHANGE:
      return numberValue(quote?.changePercent)
    case ALERT_TYPES.VOLUME_ABOVE:
      return numberValue(quote?.volume)
    case ALERT_TYPES.SIGNAL_CHANGE:
      return String(signal?.action ?? signal?.overallSignal ?? '').toUpperCase()
    case ALERT_TYPES.RISK_LIMIT:
      return numberValue(risk?.portfolioRisk ?? risk?.accountExposure ?? risk?.dollarRisk)
    case ALERT_TYPES.PORTFOLIO_DRAWDOWN:
      return numberValue(portfolio.maxDrawdown)
    default:
      return null
  }
}

function isTriggered(alert, currentValue) {
  switch (alert.alertType) {
    case ALERT_TYPES.PRICE_ABOVE:
      return numberValue(currentValue) > numberValue(alert.threshold)
    case ALERT_TYPES.PRICE_BELOW:
      return numberValue(currentValue) < numberValue(alert.threshold)
    case ALERT_TYPES.PERCENT_CHANGE:
      return Math.abs(numberValue(currentValue)) >= Math.abs(numberValue(alert.threshold))
    case ALERT_TYPES.VOLUME_ABOVE:
      return numberValue(currentValue) > numberValue(alert.threshold)
    case ALERT_TYPES.SIGNAL_CHANGE:
      return String(currentValue).toUpperCase() === String(alert.threshold).toUpperCase()
    case ALERT_TYPES.RISK_LIMIT:
      return numberValue(currentValue) >= numberValue(alert.threshold)
    case ALERT_TYPES.PORTFOLIO_DRAWDOWN:
      return Math.abs(numberValue(currentValue)) >= Math.abs(numberValue(alert.threshold))
    default:
      return false
  }
}

function buildMessage(alert, currentValue) {
  return `${alert.symbol} ${alert.alertType} triggered at ${currentValue} against ${alert.threshold}`
}

export function createAlertEvaluator({ now = () => new Date().toISOString() } = {}) {
  return {
    evaluate(alerts = [], context = {}) {
      return alerts
        .filter((alert) => alert.enabled !== false)
        .map((alert) => {
          const currentValue = getCurrentValue(alert, context)
          if (!isTriggered(alert, currentValue)) return null

          return {
            alertId: alert.id,
            type: alert.alertType,
            symbol: alert.symbol,
            currentValue,
            threshold: alert.threshold,
            triggeredAt: now(),
            message: buildMessage(alert, currentValue),
          }
        })
        .filter(Boolean)
    },
  }
}
