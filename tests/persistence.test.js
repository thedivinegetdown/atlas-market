import { describe, it, expect, vi } from 'vitest'
import { createPersistenceService } from '../lib/db/persistenceService.js'
import { initializeSchema } from '../lib/db/schema.js'

function createMockPgClient(overrides = {}) {
  return {
    connected: true,
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    ...overrides,
  }
}

describe('persistence layer', () => {
  it('returns disabled state when schema initialization is attempted without a client', async () => {
    const result = await initializeSchema(null)
    expect(result).toEqual({ ok: true, disabled: true })
  })

  it('initializes schema for active clients', async () => {
    const mockClient = createMockPgClient()
    const result = await initializeSchema(mockClient)

    expect(result).toEqual({ ok: true, disabled: false })
    expect(mockClient.query).toHaveBeenCalled()
  })

  it('persists documents through a named store when enabled', async () => {
    const mockClient = createMockPgClient()
    const service = createPersistenceService(mockClient)
    const result = await service.upsertDocument('orders', 'order-1', { side: 'buy' })

    expect(result.ok).toBe(true)
    expect(result.data).toEqual({ id: 'order-1', payload: { side: 'buy' } })
    expect(mockClient.query).toHaveBeenCalled()
  })

  it('returns an empty list and null when the store is unavailable', async () => {
    const service = createPersistenceService(null)
    await expect(service.listDocuments('missing')).resolves.toEqual([])
    await expect(service.getDocument('missing', 'x')).resolves.toBeNull()
  })

  it('supports delete operations with a disabled client', async () => {
    const service = createPersistenceService(null)
    const result = await service.deleteDocument('orders', 'order-1')

    expect(result).toEqual({ ok: true, removed: false, disabled: true })
  })
})
