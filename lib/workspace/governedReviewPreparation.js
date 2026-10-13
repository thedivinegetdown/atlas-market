import { serverLogger } from '../logging/logger.js'
import { createGovernedObservationCoverage, GOVERNED_OBSERVATION_STRATEGIES, GOVERNED_OBSERVATION_UNIVERSE } from './governedObservationCoverage.js'

const PREPARATION_STORE = 'governedReviewPreparations'
const PREPARATION_TTL_MS = 24 * 60 * 60 * 1000

function getPreparationStore(repository) {
  return repository.getStore(PREPARATION_STORE)
}

async function findActivePreparation(repository, organizationId, userId, tenantContext = {}) {
  const store = getPreparationStore(repository)
  if (!store) return null
  const records = store.findCurrentScoped
    ? [await store.findCurrentScoped(tenantContext)].filter(Boolean)
    : await store.listScoped({ organizationId, userId, teamWorkspaceId: tenantContext.teamWorkspaceId ?? null, limit: 10 })
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

export async function createOrReusePreparation(repository, organizationId, userId, tenantContext, now, idempotencyKey = null) {
  const preparationId = `prep_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
  const claimToken = `claim_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`
  const nowDate = now()
  const expiresAt = new Date(nowDate.getTime() + PREPARATION_TTL_MS).toISOString()
  const nowIso = nowDate.toISOString()

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
    idempotencyKey,
    universe: [...GOVERNED_OBSERVATION_UNIVERSE],
    strategies: GOVERNED_OBSERVATION_STRATEGIES.map(({ strategyId }) => strategyId),
    observationCoverage: createGovernedObservationCoverage({ preparationId, createdAt: nowIso }),
  }

  serverLogger.debug('createOrReusePreparation: getting store', { organizationId, userId })
  const store = getPreparationStore(repository)
  if (!store) {
    serverLogger.error('createOrReusePreparation: store not available', { organizationId, userId })
    throw new Error(`Preparation store ${PREPARATION_STORE} not available`)
  }

  serverLogger.debug('createOrReusePreparation: upserting preparation', { preparationId, organizationId, userId })
  try {
    await store.expireElapsedScoped?.(tenantContext)
    const write = await store.upsertScoped(preparationId, preparation, tenantContext)
    if (write?.disabled) throw new Error('Preparation storage is unavailable.')
    serverLogger.info('createOrReusePreparation: preparation created', { preparationId, organizationId, userId })
    return { preparation, created: true, existingId: null, reuseReason: null }
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
        err?.message?.includes('idx_atlas_governed_review_preparations_request_unique') ||
        err?.message?.includes('unique constraint') ||
        err?.code === '23505') {
      if (idempotencyKey && store.findByIdempotencyKeyScoped) {
        const matching = await store.findByIdempotencyKeyScoped(idempotencyKey, tenantContext)
        if (matching) {
          const existing = matching.payload ?? matching
          return { preparation: existing, created: false, existingId: existing.id, reuseReason: 'idempotent' }
        }
      }
      serverLogger.debug('createOrReusePreparation: unique constraint, finding existing')
      const existing = await findActivePreparation(repository, organizationId, userId, tenantContext)
      if (existing) {
        serverLogger.info('createOrReusePreparation: reused existing', { existingId: existing.id })
        return { preparation: existing, created: false, existingId: existing.id, reuseReason: 'active' }
      }
    }
    throw err
  }
}
