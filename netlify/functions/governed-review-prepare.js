import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'
import { createOrReusePreparation } from '../../../lib/workspace/governedReviewPreparation.js'
import { serverLogger } from '../../../lib/logging/logger.js'

export const handler = createOrganizationAuthenticatedApiHandler(async (context) => {
  const { organizationId, user, tenantContext, requestId } = context
  const repository = context.repository
  const now = () => new Date()

  serverLogger.info('governed review prepare start', { organizationId, userId: user.id, requestId })

  try {
    // Import preparation logic (static import - bundled at build time)
    const { preparation, created, existingId } = await createOrReusePreparation(repository, organizationId, user.id, tenantContext, now)

    serverLogger.info('governed review prepare result', { 
      preparationId: preparation.id, 
      created, 
      existingId,
      status: preparation.status 
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
    // In production, this is an internal HTTP call to the background function
    // For Netlify, we use the internal function URL pattern
    const backgroundUrl = `/.netlify/functions/governed-review-prepare-background`
    try {
      const fetchImpl = globalThis.fetch
      if (typeof fetchImpl === 'function') {
        const accessToken = context.session?.token ?? context.session?.access_token
        await fetchImpl(backgroundUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(accessToken ? { 'Authorization': `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify({ preparationId: preparation.id }),
        })
        serverLogger.info('governed review background worker triggered', { preparationId: preparation.id })
      }
    } catch (triggerErr) {
      serverLogger.warn('governed review background trigger failed', { 
        preparationId: preparation.id, 
        error: triggerErr?.message 
      })
      // Don't fail the request - background may still be invoked by Netlify
    }

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
      userId: user.id, 
      error: err?.message,
      stack: err?.stack 
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