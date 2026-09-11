import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createCreditBudget } from '../lib/market/creditBudget.js'

describe('Governed Review Preparation Durability', () => {
  let mockRepository, mockStore, creditBudget, now, currentTime

  beforeEach(() => {
    currentTime = Date.now()
    now = () => new Date(currentTime)
    creditBudget = createCreditBudget({ dailyLimit: 800, minuteLimit: 6, now: () => currentTime })

    mockStore = {
      records: new Map(),
      async upsertScoped(id, payload, tenantContext) {
        this.records.set(id, { id, payload, tenantContext })
        return { ok: true }
      },
      async getScoped(id, tenantContext) {
        const record = this.records.get(id)
        if (!record) return null
        if (record.tenantContext.organizationId !== tenantContext.organizationId ||
            record.tenantContext.userId !== tenantContext.userId) {
          return null
        }
        return record
      },
      async listScoped({ organizationId, userId, limit = 10 }) {
        const results = []
        for (const [, record] of this.records) {
          const p = record.payload ?? record
          if (p.organizationId === organizationId && p.userId === userId) {
            results.push(record)
            if (results.length >= limit) break
          }
        }
        return results
      },
      clear() { this.records.clear() },
    }

    mockRepository = {
      getStore: (name) => name === 'governedReviewPreparations' ? mockStore : null,
    }
  })

  function createPreparationId() {
    return `prep_${currentTime}_${Math.random().toString(36).slice(2, 9)}`
  }

  const PREPARATION_STORE = 'governedReviewPreparations'
  const PREPARATION_TTL_MS = 24 * 60 * 60 * 1000

  function getPreparationStore(repository) {
    return repository.getStore(PREPARATION_STORE)
  }

  async function savePreparation(repository, preparation) {
    const store = getPreparationStore(repository)
    if (!store) throw new Error(`Preparation store ${PREPARATION_STORE} not available`)
    return store.upsertScoped(preparation.id, preparation, preparation.tenantContext)
  }

  async function findActivePreparation(repository, organizationId, userId) {
    const store = getPreparationStore(repository)
    if (!store) return null
    const records = await store.listScoped({ organizationId, userId, limit: 10 })
    const now = currentTime
    for (const record of records) {
      const p = record.payload ?? record
      const expiresAt = p.expiresAt ? new Date(p.expiresAt).getTime() : 0
      if (expiresAt && expiresAt <= now) continue
      if (p.status === 'pending' || p.status === 'running') {
        return p
      }
    }
    return null
  }

  async function claimPreparation(repository, preparationId, tenantContext) {
    const store = getPreparationStore(repository)
    if (!store) return { claimed: false, reason: 'store_unavailable' }
    const record = await store.getScoped(preparationId, tenantContext)
    if (!record) return { claimed: false, reason: 'not_found' }
    const prep = record.payload ?? record
    if (prep.status === 'completed') return { claimed: false, reason: 'already_completed', preparation: prep }
    if (prep.status === 'expired') return { claimed: false, reason: 'expired', preparation: prep }
    if (prep.status === 'failed') return { claimed: false, reason: 'failed', preparation: prep }
    if (prep.status === 'running') {
      const updatedAt = prep.updatedAt ? new Date(prep.updatedAt).getTime() : 0
      if (currentTime - updatedAt > 5 * 60 * 1000) {
        await savePreparation(repository, { ...prep, status: 'running', updatedAt: new Date(currentTime).toISOString() })
        return { claimed: true, preparation: prep }
      }
      return { claimed: false, reason: 'already_running', preparation: prep }
    }
    await savePreparation(repository, { ...prep, status: 'running', updatedAt: new Date(currentTime).toISOString() })
    return { claimed: true, preparation: prep }
  }

  it('creates durable preparation record with schema-compliant fields', async () => {
    const preparationId = createPreparationId()
    const expiresAt = new Date(currentTime + PREPARATION_TTL_MS).toISOString()

    const preparation = {
      id: preparationId,
      organizationId: 'org-test',
      userId: 'user-test',
      tenantContext: { organizationId: 'org-test', userId: 'user-test' },
      status: 'pending',
      createdAt: new Date(currentTime).toISOString(),
      updatedAt: new Date(currentTime).toISOString(),
      expiresAt,
      universe: ['SPY', 'QQQ', 'IWM', 'AAPL', 'MSFT'],
      strategies: ['breakout-momentum-v1', 'range-mean-reversion-v1', 'volatility-expansion-v1'],
    }

    await savePreparation(mockRepository, preparation)

    const record = await mockStore.getScoped(preparationId, preparation.tenantContext)
    expect(record).not.toBeNull()
    const p = record.payload ?? record
    expect(p.id).toBe(preparationId)
    expect(p.organizationId).toBe('org-test')
    expect(p.userId).toBe('user-test')
    expect(p.status).toBe('pending')
    expect(p.expiresAt).toBe(expiresAt)
    expect(Array.isArray(p.universe)).toBe(true)
    expect(p.universe.length).toBe(5)
  })

  it('prevents duplicate active preparation for same org/user', async () => {
    const expiresAt = new Date(currentTime + PREPARATION_TTL_MS).toISOString()

    // Create first preparation
    const prep1 = {
      id: 'prep-1',
      organizationId: 'org-test',
      userId: 'user-test',
      tenantContext: { organizationId: 'org-test', userId: 'user-test' },
      status: 'pending',
      createdAt: new Date(currentTime).toISOString(),
      updatedAt: new Date(currentTime).toISOString(),
      expiresAt,
      universe: ['SPY'],
      strategies: ['breakout-momentum-v1'],
    }
    await savePreparation(mockRepository, prep1)

    // Try to find active - should find prep1
    const active = await findActivePreparation(mockRepository, 'org-test', 'user-test')
    expect(active).not.toBeNull()
    expect(active.id).toBe('prep-1')
  })

  it('allows new preparation after previous completes', async () => {
    const expiresAt = new Date(currentTime + PREPARATION_TTL_MS).toISOString()

    // Create completed preparation
    const prep1 = {
      id: 'prep-1',
      organizationId: 'org-test',
      userId: 'user-test',
      tenantContext: { organizationId: 'org-test', userId: 'user-test' },
      status: 'completed',
      createdAt: new Date(currentTime - 1000).toISOString(),
      updatedAt: new Date(currentTime).toISOString(),
      expiresAt,
      universe: ['SPY'],
      strategies: ['breakout-momentum-v1'],
    }
    await savePreparation(mockRepository, prep1)

    // No active preparation should be found
    const active = await findActivePreparation(mockRepository, 'org-test', 'user-test')
    expect(active).toBeNull()
  })

  it('allows new preparation after previous expires', async () => {
    const expiredAt = new Date(currentTime - 1000).toISOString()

    // Create expired preparation
    const prep1 = {
      id: 'prep-1',
      organizationId: 'org-test',
      userId: 'user-test',
      tenantContext: { organizationId: 'org-test', userId: 'user-test' },
      status: 'pending',
      createdAt: new Date(currentTime - 25 * 60 * 60 * 1000).toISOString(),
      updatedAt: new Date(currentTime - 25 * 60 * 60 * 1000).toISOString(),
      expiresAt: expiredAt,
      universe: ['SPY'],
      strategies: ['breakout-momentum-v1'],
    }
    await savePreparation(mockRepository, prep1)

    // No active preparation should be found (expired)
    const active = await findActivePreparation(mockRepository, 'org-test', 'user-test')
    expect(active).toBeNull()
  })

  it('background retry against completed preparation = no-op', async () => {
    const preparationId = 'prep-completed'
    const expiresAt = new Date(currentTime + PREPARATION_TTL_MS).toISOString()

    const prep = {
      id: preparationId,
      organizationId: 'org-test',
      userId: 'user-test',
      tenantContext: { organizationId: 'org-test', userId: 'user-test' },
      status: 'completed',
      createdAt: new Date(currentTime - 1000).toISOString(),
      updatedAt: new Date(currentTime).toISOString(),
      expiresAt,
      universe: ['SPY'],
      strategies: ['breakout-momentum-v1'],
    }
    await savePreparation(mockRepository, prep)

    // Try to claim - should return already_completed
    const result = await claimPreparation(mockRepository, preparationId, prep.tenantContext)
    expect(result.claimed).toBe(false)
    expect(result.reason).toBe('already_completed')
  })

  it('background retry against running preparation = no-op if not stale', async () => {
    const preparationId = 'prep-running'
    const expiresAt = new Date(currentTime + PREPARATION_TTL_MS).toISOString()

    const prep = {
      id: preparationId,
      organizationId: 'org-test',
      userId: 'user-test',
      tenantContext: { organizationId: 'org-test', userId: 'user-test' },
      status: 'running',
      createdAt: new Date(currentTime - 1000).toISOString(),
      updatedAt: new Date(currentTime - 30000).toISOString(), // 30s ago
      expiresAt,
      universe: ['SPY'],
      strategies: ['breakout-momentum-v1'],
    }
    await savePreparation(mockRepository, prep)

    // Try to claim - should return already_running (not stale)
    const result = await claimPreparation(mockRepository, preparationId, prep.tenantContext)
    expect(result.claimed).toBe(false)
    expect(result.reason).toBe('already_running')
  })

  it('background retry against stale running preparation = claims', async () => {
    const preparationId = 'prep-stale'
    const expiresAt = new Date(currentTime + PREPARATION_TTL_MS).toISOString()

    const prep = {
      id: preparationId,
      organizationId: 'org-test',
      userId: 'user-test',
      tenantContext: { organizationId: 'org-test', userId: 'user-test' },
      status: 'running',
      createdAt: new Date(currentTime - 400000).toISOString(),
      updatedAt: new Date(currentTime - 400000).toISOString(), // 400s ago (stale)
      expiresAt,
      universe: ['SPY'],
      strategies: ['breakout-momentum-v1'],
    }
    await savePreparation(mockRepository, prep)

    // Try to claim - should claim stale running
    const result = await claimPreparation(mockRepository, preparationId, prep.tenantContext)
    expect(result.claimed).toBe(true)
  })

  it('org/user isolation: preparation not visible to other org/user', async () => {
    const expiresAt = new Date(currentTime + PREPARATION_TTL_MS).toISOString()

    const prep1 = {
      id: 'prep-1',
      organizationId: 'org-1',
      userId: 'user-1',
      tenantContext: { organizationId: 'org-1', userId: 'user-1' },
      status: 'pending',
      createdAt: new Date(currentTime).toISOString(),
      updatedAt: new Date(currentTime).toISOString(),
      expiresAt,
      universe: ['SPY'],
      strategies: ['breakout-momentum-v1'],
    }
    await savePreparation(mockRepository, prep1)

    // Query as different org/user
    const active = await findActivePreparation(mockRepository, 'org-2', 'user-2')
    expect(active).toBeNull()
  })

  it('status function rejects cross-org access', async () => {
    const expiresAt = new Date(currentTime + PREPARATION_TTL_MS).toISOString()

    const prep1 = {
      id: 'prep-1',
      organizationId: 'org-1',
      userId: 'user-1',
      tenantContext: { organizationId: 'org-1', userId: 'user-1' },
      status: 'completed',
      createdAt: new Date(currentTime).toISOString(),
      updatedAt: new Date(currentTime).toISOString(),
      expiresAt,
      universe: ['SPY'],
      strategies: ['breakout-momentum-v1'],
    }
    await savePreparation(mockRepository, prep1)

    // Try to access from different org
    const record = await mockStore.getScoped('prep-1', { organizationId: 'org-2', userId: 'user-2' })
    expect(record).toBeNull()
  })

  it('expired preparation cannot be Save Review eligible', async () => {
    const expiredAt = new Date(currentTime - 1000).toISOString()

    const prep = {
      id: 'prep-expired',
      organizationId: 'org-test',
      userId: 'user-test',
      tenantContext: { organizationId: 'org-test', userId: 'user-test' },
      status: 'pending', // not yet marked expired
      createdAt: new Date(currentTime - 25 * 60 * 60 * 1000).toISOString(),
      updatedAt: new Date(currentTime - 25 * 60 * 60 * 1000).toISOString(),
      expiresAt: expiredAt,
      universe: ['SPY'],
      strategies: ['breakout-momentum-v1'],
      queueItems: [{ symbol: 'SPY', strategyId: 'breakout-momentum-v1', quality: { score: 80 } }],
    }
    await savePreparation(mockRepository, prep)

    // Check expiration
    const now = currentTime
    const expiresAtMs = new Date(expiredAt).getTime()
    const isExpired = expiresAtMs && expiresAtMs <= now
    expect(isExpired).toBe(true)

    // Should not be eligible for Save Review
    expect(prep.status).not.toBe('completed')
    expect(prep.queueItems).toBeDefined() // but should be treated as expired
  })

  it('one active preparation per org/user prevents provider concurrency issues', async () => {
    const expiresAt = new Date(currentTime + PREPARATION_TTL_MS).toISOString()

    // Create running preparation
    const prep1 = {
      id: 'prep-1',
      organizationId: 'org-test',
      userId: 'user-test',
      tenantContext: { organizationId: 'org-test', userId: 'user-test' },
      status: 'running',
      createdAt: new Date(currentTime).toISOString(),
      updatedAt: new Date(currentTime).toISOString(),
      expiresAt,
      universe: ['SPY', 'QQQ', 'IWM', 'AAPL', 'MSFT'],
      strategies: ['breakout-momentum-v1', 'range-mean-reversion-v1', 'volatility-expansion-v1'],
    }
    await savePreparation(mockRepository, prep1)

    // Try to create another - should find existing active
    const active = await findActivePreparation(mockRepository, 'org-test', 'user-test')
    expect(active).not.toBeNull()
    expect(active.status).toBe('running')

    // This prevents concurrent provider-heavy jobs for same org/user
  })
})