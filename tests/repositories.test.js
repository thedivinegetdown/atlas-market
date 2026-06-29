import { describe, expect, beforeEach, it } from 'vitest'
import { resetStore } from '../lib/repositories/store.js'
import { createOrderRepository } from '../lib/repositories/orderRepository.js'
import { createPortfolioRepository } from '../lib/repositories/portfolioRepository.js'
import { createJournalRepository } from '../lib/repositories/journalRepository.js'
import { createEventRepository } from '../lib/repositories/eventRepository.js'

beforeEach(() => {
  resetStore()
})

describe('repositories', () => {
  it('creates, updates, lists, and finds orders', () => {
    const orders = createOrderRepository()
    const created = orders.create({ symbol: 'AAPL', side: 'buy', quantity: 2 })

    const updated = orders.update(created.id, (current) => ({ ...current, status: 'filled' }))
    const found = orders.find(created.id)
    const listed = orders.list()

    expect(updated.status).toBe('filled')
    expect(found.id).toBe(created.id)
    expect(listed).toHaveLength(1)
  })

  it('gets and updates portfolio state', () => {
    const portfolios = createPortfolioRepository()
    const created = portfolios.create({ name: 'Main', cash: 1000 })
    const updated = portfolios.update(created.id, (current) => ({ ...current, cash: 1200 }))

    expect(updated.cash).toBe(1200)
    expect(portfolios.find(created.id).cash).toBe(1200)
  })

  it('creates and lists journal entries', () => {
    const journals = createJournalRepository()
    journals.create({ message: 'Opened position' })
    journals.create({ message: 'Closed position' })

    expect(journals.list()).toHaveLength(2)
  })

  it('appends and lists events', () => {
    const events = createEventRepository()
    events.append({ message: 'Booted' })
    events.append({ message: 'Synced' })

    expect(events.list()).toHaveLength(2)
    expect(events.list()[1].message).toBe('Synced')
  })
})
