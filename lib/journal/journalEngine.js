import { createId } from '../core/id.js'
import { eventBus } from '../core/eventBus.js'

export function createJournalEngine(repositories = {}) {
  const journalRepository = repositories.journalRepository
  
  // Listen for order:updated events with FILLED state to auto-create journal entries
  if (journalRepository) {
    eventBus.subscribe('order:updated', (payload) => {
      const { order } = payload
      // Only create entry when order is actually filled
      if (order && order.state === 'FILLED') {
        journalRepository.create({
          journalId: createId('journal'),
          orderId: order.id,
          symbol: order.symbol,
          side: order.side,
          quantity: order.quantity,
          fillPrice: order.filledPrice ?? order.price,
          message: `${order.side} ${order.symbol} filled at ${order.filledPrice ?? order.price}`,
          type: 'ORDER_FILLED',
          createdAt: new Date().toISOString(),
        })

        // Emit journal:created event
        eventBus.emit('journal:created', { 
          entry: { 
            orderId: order.id, 
            symbol: order.symbol, 
            type: 'ORDER_FILLED',
            message: `Order filled: ${order.quantity} ${order.symbol} @ ${order.filledPrice}`
          } 
        })
      }
    })
  }

  return {
    createEntry({ orderId, symbol, side, quantity, fillPrice, thesis = '', tags = [], pnl = 0 }) {
      return {
        journalId: createId('journal'),
        orderId,
        symbol,
        side,
        quantity,
        fillPrice,
        thesis,
        tags,
        pnl,
        createdAt: new Date().toISOString(),
      }
    },
  }
}
