import { serverLogger } from '../logging/logger.js'

export const TRADING_EVENTS = Object.freeze({
  ORDER_SUBMITTED: 'order_submitted',
  ORDER_REJECTED: 'order_rejected',
  ORDER_CANCELLED: 'order_cancelled',
  POSITION_UPDATED: 'position_updated',
  PORTFOLIO_RECALCULATED: 'portfolio_recalculated',
  JOURNAL_ENTRY_CREATED: 'journal_entry_created',
  API_ERROR: 'api_error',
})

export function createEventLogger({ logger = serverLogger } = {}) {
  return {
    log(eventType, metadata = {}) {
      return logger.info('atlas trading event', {
        eventType,
        requestId: metadata.requestId,
        ...metadata,
      })
    },

    error(eventType, metadata = {}) {
      return logger.error('atlas trading event failed', {
        eventType,
        requestId: metadata.requestId,
        ...metadata,
      })
    },
  }
}

export const tradingEventLogger = createEventLogger()
