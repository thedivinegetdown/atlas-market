import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'
import { runMigrations } from '../../../lib/db/migrations.js'
import { serverLogger } from '../../../lib/logging/logger.js'

const PREPARATION_STORE = 'governedReviewPreparations'
const PREPARATION_TTL_MS = 24 * 60 * 60 * 1000

function createPreparationId() {
  return `prep_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

function createClaimToken() {
  return `claim_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`
}

function getPreparationStore(repository) {
  return repository.getStore(PREPARATION_STORE)
}

async function findActivePreparation(repository, organizationId, userId) {
  const store = repository.getStore(PREPARATION_STORE)
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
  const now = () => new Date()

  serverLogger.info('governed review prepare start', { 
    organizationId, 
    userId: user?.id, 
    requestId,
    hasRepo: !!repository,
    hasSession: !!session,
    hasToken: !!(session?.token ?? session?.access_token)
  })

  try {
    // Ensure migrations are applied (idempotent)
    if (repository?.initialize) {
      serverLogger.debug('governed review initializing repository')
      await repository.initialize()
      serverLogger.info('governed review repository initialized')
    }

    const store = repository.getStore('governedReviewPreparations')
    if (!store) {
      throw new Error('Preparation store governedReviewPreparations not available')
    }

    const preparationId = `prep_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
    const claimToken = `claim_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    const nowIso = new Date().toISOString()

    const preparation = {
      id: preparationId,
      organizationId,
      userId: user.id,
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

    serverLogger.debug('governed review createOrReusePreparation start', { organizationId, userId: user.id })
    let preparationResult
    try {
      await store.upsertScoped(preparationId, preparation, tenantContext)
      preparationResult = { preparation, created: true, existingId: null }
      serverLogger.info('governed review preparation created', { preparationId, organizationId, userId: user.id })
    } catch (err) {
      if (err?.message?.includes('idx_atlas_governed_review_preparations_active_unique') ||
          err?.message?.includes('unique constraint') ||
          err?.code === '23505') {
        const existing = await (async () => {
          const records = await store.listScoped({ organizationId, userId: user.id, limit: 10 })
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
        })()
        if (existing) {
          preparationResult = { preparation: existing, created: false, existingId: existing.id }
          serverLogger.info('governed review reused existing', { existingId: existing.id })
        } else {
          throw err
        }
      } else {
        throw err
      }
    }

    const { preparation, created, existingId } = preparationResult

    serverLogger.info('governed review prepare result', { 
      preparationId: preparation?.id, 
      created, 
      existingId,
      status: preparation?.status 
    })

    if (!created) {
      return {
        ok: true,
        data: {
          preparationId: existingId,
          status: preparation.status,
          message: 'Governed review preparation already in progress',
          reused: true,
        },
      }
    }

    // Trigger background worker (fire-and-forget)
    const backgroundUrl = `/.netlify/functions/governed-review-prepare-background`
    try {
      const fetchImpl = globalThis.fetch
      if (typeof fetchImpl === 'function') {
        const accessToken = session?.token ?? session?.access_token
        serverLogger.debug('governed review triggering background', { preparationId: preparation.id, hasToken: !!accessToken })
        const bgResponse = await fetchImpl(backgroundUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(accessToken ? { 'Authorization': `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify({ preparationId: preparation.id }),
        })
        serverLogger.info('governed review background worker triggered', { 
          preparationId: preparation.id, 
          bgStatus: bgResponse.status,
          bgOk: bgResponse.ok 
        })
      } else {
        serverLogger.warn('governed review no fetch implementation available')
      }
    } catch (triggerErr) {
      serverLogger.warn('governed review background trigger failed', { 
        preparationId: preparation.id, 
        error: triggerErr?.message,
        stack: triggerErr?.stack
      })
    }

    serverLogger.info('governed review prepare returning success', { preparationId: preparation.id })
    return {
      ok: true,
      data: {
        preparationId: preparation.id,
        status: 'pending',
        message: 'Governed review preparation started',
      },
    }
  } catch (err) {
    serverLogger.error('governed review prepare handler error', { 
      organizationId, 
      userId: user?.id, 
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