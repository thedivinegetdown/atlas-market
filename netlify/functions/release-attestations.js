import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createReleaseAttestation, createReleaseAttestationRepository } from '../../lib/system/releaseAttestationGateEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertAccess(membership, method) {
  const role = membership?.role
  if (String(method).toUpperCase() === 'GET' && ['owner', 'admin', 'analyst', 'viewer'].includes(role)) return
  if (['owner', 'admin'].includes(role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Release attestation access denied', { statusCode: 403, publicMessage: 'release attestation access denied' })
}

export function createReleaseAttestationsHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertAccess(membership, event.httpMethod)
    const repository = options.releaseAttestationRepository ?? createReleaseAttestationRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const result = createReleaseAttestation({ ...options, ...body, tenantContext, accountId: body.accountId ?? query.accountId ?? options.accountId }, { emitEvent: false })
      const saved = await repository.create?.(result.releaseAttestation)
      return { event: apiFoundationEvent({ requestId, endpoint: 'release-attestations', status: result.attestationState }), releaseAttestation: { ...result, persisted: saved?.ok }, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const attestations = await repository.list?.({ tenantContext, accountId: query.accountId ?? options.accountId, releaseCandidateId: query.releaseCandidateId, attestationState: query.attestationState, limit: query.limit }) ?? []
    return { event: apiFoundationEvent({ requestId, endpoint: 'release-attestations', status: 'ok' }), releaseAttestations: attestations, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'release-attestations', ...options })
}

export const handler = createReleaseAttestationsHandler()
