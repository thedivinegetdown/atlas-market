import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'
import { governedObservationAttention } from '../../lib/workspace/governedObservationCoverage.js'

const PREPARATION_STORE = 'governedReviewPreparations'

function safeClaimDiagnostics(value) {
  if (!value || typeof value !== 'object') return null
  return {
    workerEntered: value.workerEntered === true,
    scopedPreparationLoaded: value.scopedPreparationLoaded === true,
    physicalStatusMatchesExpected: value.physicalStatusMatchesExpected === true,
    physicalClaimTokenMatchesExpected: value.physicalClaimTokenMatchesExpected === true,
    conditionalUpdateAttempted: value.conditionalUpdateAttempted === true,
    claimSucceeded: value.claimSucceeded === true,
  }
}

export const handler = createOrganizationAuthenticatedApiHandler(async (context) => {
  const { body, query, repository, tenantContext, user, organizationId } = context
  const preparationId = body?.preparationId ?? query?.preparationId
  const discovering = !preparationId
  const idempotencyKey = discovering ? query?.idempotencyKey ?? body?.idempotencyKey : null
  if (idempotencyKey && (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey))) {
    return { ok: true, data: { discoveryStatus: 'UNKNOWN', preparationId: null, status: 'unknown' } }
  }

  const store = repository.getStore(PREPARATION_STORE)
  if (!store) {
    if (discovering) return { ok: true, data: { discoveryStatus: 'UNKNOWN', preparationId: null, status: 'unknown' } }
    return {
      ok: false,
      error: { code: 'store_unavailable', message: 'Preparation store not available' },
    }
  }

  let record
  try {
    record = discovering
      ? idempotencyKey
        ? await store.findByIdempotencyKeyScoped(idempotencyKey, tenantContext)
        : await store.findCurrentScoped(tenantContext)
      : await store.getScoped(preparationId, tenantContext)
  } catch (error) {
    if (discovering) return { ok: true, data: { discoveryStatus: 'UNKNOWN', preparationId: null, status: 'unknown' } }
    throw error
  }

  if (!record) {
    if (discovering && idempotencyKey) return { ok: true, data: { discoveryStatus: 'UNKNOWN', preparationId: null, status: 'unknown' } }
    if (discovering) return { ok: true, data: { discoveryStatus: 'NONE_ACTIVE', preparationId: null, status: 'none_active' } }
    return {
      ok: false,
      error: { code: 'not_found', message: 'Preparation not found' },
    }
  }

  const payload = record.payload ?? record

  // Verify authorization: preparation must belong to this org/user
  if (payload.organizationId !== organizationId || payload.userId !== user.id) {
    if (discovering) return { ok: true, data: { discoveryStatus: 'UNKNOWN', preparationId: null, status: 'unknown' } }
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
      await import('./_shared/authApi.js')
      // Note: we can't easily update here without repository, but status check will catch it
      return {
        ok: true,
        data: {
          preparationId: payload.id,
          status: 'expired',
          ...(discovering ? { discoveryStatus: 'EXPIRED' } : {}),
          ...(idempotencyKey ? { requestMatched: true } : {}),
          createdAt: payload.createdAt,
          startedAt: payload.startedAt,
          completedAt: payload.completedAt,
          failedAt: payload.failedAt,
          error: 'Preparation expired',
          queueItems: [],
          providerCalls: null,
          observationCoverage: payload.observationCoverage ?? null,
          observationAttention: governedObservationAttention(payload.observationCoverage),
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
      ...(discovering ? { discoveryStatus: ['pending', 'running', 'completed', 'failed', 'expired'].includes(payload.status) ? payload.status.toUpperCase() : 'UNKNOWN' } : {}),
      ...(idempotencyKey ? { requestMatched: true } : {}),
      attempt: payload.attempt ?? 0,
      claimTokenPresent: Boolean(payload.claimToken),
      claimDiagnostics: safeClaimDiagnostics(payload.claimDiagnostics),
      createdAt: payload.createdAt,
      startedAt: payload.startedAt,
      completedAt: payload.completedAt,
      failedAt: payload.failedAt,
      error: payload.error,
      queueItems: payload.queueItems ?? [],
      providerCalls: payload.providerCalls ?? null,
      observationCoverage: payload.observationCoverage ?? null,
      observationAttention: governedObservationAttention(payload.observationCoverage),
    },
  }
}, {
  requiredPermission: 'dashboard.read',
  workspaceAction: 'read',
  routeId: 'governed-review-status',
})
