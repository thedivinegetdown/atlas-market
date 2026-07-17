import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createReleaseDocumentationRepository, generateReleaseDocumentation, RELEASE_DOCUMENTATION_TYPES } from '../../lib/system/releaseDocumentationEngine.js'
import { assertAllowedEnum, requireAccountContext } from '../../lib/security/securityPolicyEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertAccess(membership, method) {
  const role = membership?.role
  if (String(method).toUpperCase() === 'GET' && ['owner', 'admin', 'analyst', 'viewer'].includes(role)) return
  if (['owner', 'admin', 'analyst'].includes(role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Release documentation access denied', { statusCode: 403, publicMessage: 'release documentation access denied' })
}

export function createReleaseDocumentationHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertAccess(membership, event.httpMethod)
    const repository = options.releaseDocumentationRepository ?? createReleaseDocumentationRepository(options)
    const accountId = requireAccountContext(body.accountId ?? query.accountId ?? options.accountId)
    const documentationType = body.documentationType ? assertAllowedEnum(body.documentationType, RELEASE_DOCUMENTATION_TYPES, 'documentationType') : query.documentationType
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const result = generateReleaseDocumentation({ ...options, ...body, documentationType, tenantContext, accountId }, { emitEvent: false })
      const saved = await repository.create?.(result.releaseDocumentation)
      return { event: apiFoundationEvent({ requestId, endpoint: 'release-documentation', status: result.documentationState }), releaseDocumentation: { ...result, persisted: saved?.ok }, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const docs = await repository.list?.({ tenantContext, accountId, releaseCandidateId: query.releaseCandidateId, documentationType, documentationState: query.documentationState, limit: query.limit }) ?? []
    return { event: apiFoundationEvent({ requestId, endpoint: 'release-documentation', status: 'ok' }), releaseDocumentation: docs, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'release-documentation', ...options })
}

export const handler = createReleaseDocumentationHandler()
