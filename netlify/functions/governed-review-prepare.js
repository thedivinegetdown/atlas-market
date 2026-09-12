import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'
import { createOrReusePreparation } from '../../../lib/workspace/governedReviewPreparation.js'
import { runMigrations } from '../../../lib/db/migrations.js'
import { serverLogger } from '../../../lib/logging/logger.js'

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

    serverLogger.debug('governed review createOrReusePreparation start', { organizationId, userId: user?.id })
    const { preparation, created, existingId } = await createOrReusePreparation(repository, organizationId, user.id, tenantContext, now)

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