import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { certifyReleaseCandidate, createReleaseCertificationRepository } from '../../lib/system/releaseCertificationEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertAccess(membership, method) {
  const role = membership?.role
  if (String(method).toUpperCase() === 'GET' && ['owner', 'admin', 'analyst', 'viewer'].includes(role)) return
  if (['owner', 'admin', 'analyst'].includes(role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Release certification access denied', { statusCode: 403, publicMessage: 'release certification access denied' })
}

export function createReleaseCertificationsHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertAccess(membership, event.httpMethod)
    const repository = options.releaseCertificationRepository ?? createReleaseCertificationRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const certified = certifyReleaseCandidate({ ...options, ...body, tenantContext, accountId: body.accountId ?? query.accountId ?? options.accountId }, { emitEvent: false })
      const saved = await repository.create?.(certified.releaseCertification)
      return { event: apiFoundationEvent({ requestId, endpoint: 'release-certifications', status: certified.certificationState }), releaseCertification: { ...certified, persisted: saved?.ok }, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const certifications = await repository.list?.({ tenantContext, accountId: query.accountId ?? options.accountId, certificationState: query.certificationState, limit: query.limit }) ?? []
    return { event: apiFoundationEvent({ requestId, endpoint: 'release-certifications', status: 'ok' }), releaseCertifications: certifications, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'release-certifications', ...options })
}

export const handler = createReleaseCertificationsHandler()
