import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

const PREPARATION_STORE = 'governedReviewPreparations'

export const handler = createOrganizationAuthenticatedApiHandler(async (context) => {
  const { body, query, repository, tenantContext } = context
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

  return {
    ok: true,
    data: {
      preparationId: payload.id,
      status: payload.status,
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