import { createPaperBroker } from '../../lib/broker/paperBroker.js'
import { createJournalRepository } from '../../lib/repositories/journalRepository.js'
import { createOrderRepository } from '../../lib/repositories/orderRepository.js'
import { createPortfolioRepository } from '../../lib/repositories/portfolioRepository.js'

export const orderRepository = createOrderRepository()
export const portfolioRepository = createPortfolioRepository()
export const journalRepository = createJournalRepository()

export const paperBroker = createPaperBroker({
  orderRepository,
  portfolioRepository,
  journalRepository,
})
