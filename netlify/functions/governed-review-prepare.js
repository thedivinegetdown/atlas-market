import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'
import { serverLogger } from '../../../lib/logging/logger.js'

// Force rebuild: 2025-09-12

const PREPARATION_STORE = 'governedReviewPreparations'
const PREPARATION_TTL_MS = 24 * 60 * 60 * 1000

function createPreparationId() {
  return `prep_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

function createClaimToken() {
  return `claim_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`
}

function getPreparationStore(repository) {
  return repository.getStore('governedReviewPreparations')
}

async function findActivePreparation(repository, organizationId, userId) {
  const store = repository.getStore('governedReviewPreparations')
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

export const handler = createOrganizationAuthenticatedApiHandler(async (context) => {
  const { organizationId, user, tenantContext, requestId, session } = context
  const repository = context.repository

  const log = (...args) => serverLogger.debug('[governed-review-prepare]', ...args)

  const now = Date.now()
  log('start', { organizationId, userId: user?.id })

  try {
    // Ensure repository is initialized (idempotent)
    if (repository?.initialize && !repository._initialized) {
      log('initializing repository')
      const initStart = Date.now()
      await repository.initialize()
      repository._initialized = true
      log('repository initialized', { elapsedMs: Date.now() - initStart })
    }

    const store = repository.getStore('governedReviewPreparations')
    if (!store) {
      throw new Error('Preparation store governedReviewPreparations not available')
    }

    const preparationId = `prep_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
    const claimToken = `claim_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

    const preparation = {
      id: preparationId,
      organizationId,
      userId: user.id,
      tenantContext,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      expiresAt,
      attempt: 0,
      claimToken,
      universe: ['SPY', 'QQQ', 'IWM', 'AAPL', 'MSFT'],
      strategies: ['breakout-momentum-v1', 'range-mean-reversion-v1', 'volatility-expansion-v1'],
    }

    log('creating preparation', { preparationId, organizationId, userId: user.id })
    let preparationResult
    try {
      const insertStart = Date.now()
      await store.upsertScoped(preparationId, preparation, tenantContext)
      log('upsert completed', { elapsedMs: Date.now() - insertStart })
      preparationResult = { preparation, created: true, existingId: null }
      log('preparation created', { preparationId })
    } catch (err) {
      if (err?.message?.includes('idx_atlas_governed_review_preparations_active_unique') ||
          err?.message?.includes('unique constraint') ||
          err?.code === '23505') {
        const records = await store.listScoped({ organizationId, userId: user.id, limit: 10 })
        const now = Date.now()
        let existing = null
        for (const record of records) {
          const p = record.payload ?? record
          const expiresAt = p.expiresAt ? new Date(p.expiresAt).getTime() : 0
          if (expiresAt && expiresAt <= Date.now()) continue
          if (p.status === 'pending' || p.status === 'running') {
            existing = p
            break
          }
        }
        if (existing) {
          preparationResult = { preparation: existing, created: false, existingId: existing.id }
        } else {
          throw err
        }
      } else {
        throw err
      }
    }

    const { preparation: prep, created, existingId } = preparationResult

    if (!created) {
      return {
        ok: true,
        data: {
          preparationId: existingId,
          status: prep.status,
          message: 'Governed review preparation already in progress',
          reused: true,
        },
      }
    }

    // Trigger background worker - fire and forget with timeout
    const backgroundUrl = `/.netlify/functions/governed-review-prepare-background`
    try {
      const accessToken = context.session?.token ?? context.session?.access_token
      const fetchController = new AbortController()
      const timeoutId = setTimeout(() => fetchController.abort(), 5000)
      const fetchStart = Date.now()
      await fetch(`/.netlify/functions/governed-review-prepare-background`, {
        method: 'POST',
        signal: fetchController.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { 'Authorization': `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ preparationId: prep.id }),
      })
      clearTimeout(timeoutId)
      log('background worker triggered', { elapsedMs: Date.now() - fetchStart })
    } catch (triggerErr) {
      serverLogger.warn('background trigger failed', { error: triggerErr?.message })
    }

    log('returning success', { totalElapsedMs: Date.now() - now })
    return {
      ok: true,
      data: {
        preparationId: prep.id,
        status: 'pending',
        message: 'Governed review preparation started',
      },
    }
  } catch (err) {
    serverLogger.error('governed review prepare error', { 
      error: err?.message,
      stack: err?.stack,
      name: err?.name,
      code: err?.code
    })
    return {
      ok: false,
      error: {
        code: 'preparation_start_failed',
        message: 'Unable to start governed review preparation',
        details: err?.message ?? 'Unknown error',
      },
    }
  }
}, {
  requiredPermission: 'dashboard.read',
  workspaceAction: 'read',
  routeId: 'governed-review-prepare',
})