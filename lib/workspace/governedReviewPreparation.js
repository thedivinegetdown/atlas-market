import { createCreditBudget } from '../market/creditBudget.js'
import { BREAKOUT_OBSERVATION_UNIVERSE } from '../opportunities/forwardTest/forwardObservationEngine.js'
import { serverLogger } from '../logging/logger.js'

const PREPARATION_STORE = 'governedReviewPreparations'
const PREPARATION_TTL_MS = 24 * 60 * 60 * 1000
const STALE_THRESHOLD_MS = 5 * 60 * 1000

function createPreparationId() {
  return `prep_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

function createClaimToken() {
  return `claim_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`
}

function getPreparationStore(repository) {
  return repository.getStore(PREPARATION_STORE)
}

async function savePreparation(repository, preparation) {
  const store = getPreparationStore(repository)
  if (!store) {
    throw new Error(`Preparation store ${PREPARATION_STORE} not available`)
  }
  return store.upsertScoped(preparation.id, preparation, preparation.tenantContext)
}

async function findActivePreparation(repository, organizationId, userId) {
  const store = getPreparationStore(repository)
  if (!store) return null
  const records = await store.listScoped({ organizationId, userId, limit: 10 })
  const now = Date.now()
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

export async function createOrReusePreparation(repository, organizationId, userId, tenantContext, now) {
  const preparationId = `prep_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
  const claimToken = `claim_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  const nowIso = now().toISOString()

  const preparation = {
    id: preparationId,
    organizationId,
    userId,
    tenantContext,
    status: 'pending',
    createdAt: nowIso,
    updatedAt: nowIso,
    expiresAt,
    attempt: 0,
    claimToken,
    universe: ['SPY', 'QQQ', 'IWM', 'AAPL', 'MSFT'],
    strategies: ['breakout-momentum-v1', 'range-mean-reversion-v1', 'volatility-expansion-v1'],
  }

  serverLogger.debug('createOrReusePreparation: getting store', { organizationId, userId })
  const store = getPreparationStore(repository)
  if (!store) {
    serverLogger.error('createOrReusePreparation: store not available', { organizationId, userId })
    throw new Error(`Preparation store ${PREPARATION_STORE} not available`)
  }

  serverLogger.debug('createOrReusePreparation: upserting preparation', { preparationId, organizationId, userId })
  try {
    await store.upsertScoped(preparationId, preparation, tenantContext)
    serverLogger.info('createOrReusePreparation: preparation created', { preparationId, organizationId, userId })
    return { preparation, created: true, existingId: null }
  } catch (err) {
    serverLogger.warn('createOrReusePreparation: upsert failed', { 
      preparationId, 
      organizationId, 
      userId, 
      error: err?.message,
      code: err?.code,
      stack: err?.stack
    })
    if (err?.message?.includes('idx_atlas_governed_review_preparations_active_unique') ||
        err?.message?.includes('unique constraint') ||
        err?.code === '23505') {
      serverLogger.debug('createOrReusePreparation: unique constraint, finding existing')
      const existing = await findActivePreparation(repository, organizationId, userId)
      if (existing) {
        serverLogger.info('createOrReusePreparation: reused existing', { existingId: existing.id })
        return { preparation: existing, created: false, existingId: existing.id }
      }
    }
    throw err
  }
}