import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'
import { serverLogger } from '../../lib/logging/logger.js'
import { createOrReusePreparation } from '../../lib/workspace/governedReviewPreparation.js'

export function resolveBackgroundDispatchUrl(event = {}, env = process.env) {
  const baseUrl = event.rawUrl ?? env.URL ?? env.DEPLOY_PRIME_URL
  if (!baseUrl) throw new Error('Background dispatch origin is unavailable.')
  return new URL('/.netlify/functions/governed-review-prepare-background', baseUrl).toString()
}

export const handler = createOrganizationAuthenticatedApiHandler(async (context) => {
  const { organizationId, user, tenantContext, session, event } = context
  const repository = context.repository

  const log = (...args) => serverLogger.debug('[governed-review-prepare]', ...args)

  const now = Date.now()
  log('start', { organizationId, userId: user?.id, hasOrg: !!organizationId, hasUser: !!user?.id })

  try {
    // Stage: AUTH_CONTEXT_VALIDATED
    if (!organizationId || !user?.id) {
      return {
        ok: false,
        error: { code: 'AUTH_CONTEXT_FAILED', message: 'Missing organizationId or userId after auth' }
      }
    }

    // Stage: REPOSITORY_INIT
    if (repository?.initialize && !repository._initialized) {
      log('initializing repository')
      const initStart = Date.now()
      try {
        await repository.initialize()
        repository._initialized = true
        log('repository initialized', { elapsedMs: Date.now() - initStart })
      } catch (initErr) {
        return {
          ok: false,
          error: { code: 'MIGRATION_FAILED', message: 'Repository initialization failed', details: initErr?.message }
        }
      }
    }

    // Stage: STORE_AVAILABILITY
    const store = repository.getStore('governedReviewPreparations')
    if (!store) {
      return {
        ok: false,
        error: { code: 'STORE_UNAVAILABLE', message: 'governedReviewPreparations store not available' }
      }
    }

    log('creating preparation', { organizationId, userId: user.id })
    let preparationResult
    try {
      const insertStart = Date.now()
      preparationResult = await createOrReusePreparation(repository, organizationId, user.id, tenantContext, () => new Date())
      log('upsert completed', { elapsedMs: Date.now() - insertStart })
      log('preparation created', { preparationId: preparationResult.preparation.id })
    } catch (err) {
      return { ok: false, error: { code: 'PREPARATION_WRITE_FAILED', message: 'Failed to write preparation', details: err?.message } }
    }

    const { preparation: prep, created, existingId } = preparationResult

    const shouldDispatch = created || prep.status === 'pending'
    if (!shouldDispatch) {
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

    // Stage: BACKGROUND_DISPATCH
    try {
      const backgroundUrl = resolveBackgroundDispatchUrl(event)
      const accessToken = context.session?.token ?? context.session?.access_token
      const fetchController = new AbortController()
      const timeoutId = setTimeout(() => fetchController.abort(), 5000)
      const fetchStart = Date.now()
      const bgResponse = await fetch(backgroundUrl, {
        method: 'POST',
        signal: fetchController.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { 'Authorization': `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ preparationId: prep.id }),
      })
      clearTimeout(timeoutId)
      if (!bgResponse.ok) {
        return {
          ok: false,
          error: { code: 'BACKGROUND_DISPATCH_FAILED', message: 'Background worker dispatch failed', details: `HTTP ${bgResponse.status}` }
        }
      }
      log('background worker triggered', { elapsedMs: Date.now() - fetchStart })
    } catch (triggerErr) {
      return {
        ok: false,
        error: { code: 'BACKGROUND_DISPATCH_FAILED', message: 'Background worker dispatch failed', details: triggerErr?.message }
      }
    }

    log('returning success', { totalElapsedMs: Date.now() - now })
    return {
      ok: true,
      data: {
        preparationId: prep.id,
        status: prep.status,
        message: created ? 'Governed review preparation started' : 'Governed review preparation dispatch resumed',
        reused: !created,
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
        code: 'PREPARATION_START_FAILED',
        message: 'Unable to start governed review preparation',
        details: err?.message ?? 'Unknown error',
      },
    }
  }
}, {
  requiredPermission: 'dashboard.read',
  workspaceAction: 'read',
  routeId: 'governed-review-prepare',
  allowedMethods: ['GET', 'POST'],
})
