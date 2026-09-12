import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

const PREPARATION_STORE = 'governedReviewPreparations'

export const handler = createOrganizationAuthenticatedApiHandler(async (context) => {
  const { body, query, repository, tenantContext, user, organizationId } = context
  const preparationId = body?.preparationId ?? query?.preparationId

  if (!preparationId) {
    return {
      ok: false,
      error: { code: 'validation_error', message: 'preparationId is required' },
    }
  }

  const store = repository.getStore(PREPARATION_STORE)
  if (!store) {
    return {
      ok: false,
      error: { code: 'store_unavailable', message: 'Preparation store not available' },
    }
  }

  const record = await store.getScoped(preparationId, tenantContext)

  if (!record) {
    return {
      ok: false,
      error: { code: 'not_found', message: 'Preparation not found' },
    }
  }

  const payload = record.payload ?? record

  // Verify authorization: preparation must belong to this org/user
  if (payload.organizationId !== organizationId || payload.userId !== user.id) {
    return {
      ok: false,
      error: { code: 'forbidden', message: 'Access denied' },
    }
  }

  // Check expiration
  const now = Date.now()
  const expiresAt = payload.expiresAt ? new Date(payload.expiresAt).getTime() : 0
  if (expiresAt && expiresAt <= now) {
    // Mark as expired if not already
    if (payload.status !== 'expired' && payload.status !== 'completed' && payload.status !== 'failed') {
      const { createOrganizationAuthenticatedApiHandler: _ } = await import('./_shared/authApi.js')
      // Note: we can't easily update here without repository, but status check will catch it
      return {
        ok: true,
        data: {
          preparationId: payload.id,
          status: 'expired',
          createdAt: payload.createdAt,
          startedAt: payload.startedAt,
          completedAt: payload.completedAt,
          failedAt: payload.failedAt,
          error: 'Preparation expired',
          queueItems: [],
          providerCalls: null,
          expired: true,
        },
      }
    }
  }

  return {
    ok: true,
    data: {
      preparationId: payload.id,
      status: payload.status,
      attempt: payload.attempt ?? 0,
      claimTokenPresent: Boolean(payload.claimToken),
      createdAt: payload.createdAt,
      startedAt: payload.startedAt,
      completedAt: payload.completedAt,
      failedAt: payload.failedAt,
      error: payload.error,
      queueItems: payload.queueItems ?? [],
      providerCalls: payload.providerCalls ?? null,
    },
  }
}, {
  requiredPermission: 'dashboard.read',
  workspaceAction: 'read',
  routeId: 'governed-review-status',
})