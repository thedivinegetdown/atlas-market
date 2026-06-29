import { createId } from '../core/id.js'

export function createJournalEngine() {
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
