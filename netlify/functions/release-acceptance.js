import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createReleaseAcceptanceRepository, createReleaseAcceptanceRun, RELEASE_ACCEPTANCE_SUITE_TYPES } from '../../lib/system/releaseAcceptanceEngine.js'
import { assertAllowedEnum, evaluateSensitiveAction, requireAccountContext } from '../../lib/security/securityPolicyEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertAccess(membership, method, suiteType, paperSmokeAuthorized) {
  const role = membership?.role
  if (String(method).toUpperCase() === 'GET' && ['owner', 'admin', 'analyst', 'viewer'].includes(role)) return
  if (paperSmokeAuthorized || suiteType === 'post_deployment_smoke') {
    if (['owner', 'admin'].includes(role)) return
  } else if (['owner', 'admin', 'analyst'].includes(role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Release acceptance access denied', { statusCode: 403, publicMessage: 'release acceptance access denied' })
}

export function createReleaseAcceptanceHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    const suiteType = body.suiteType ? assertAllowedEnum(body.suiteType, RELEASE_ACCEPTANCE_SUITE_TYPES, 'suiteType') : query.suiteType
    assertAccess(membership, event.httpMethod, suiteType, body.paperSmokeAuthorized)
    const repository = options.releaseAcceptanceRepository ?? createReleaseAcceptanceRepository(options)
    const accountId = requireAccountContext(body.accountId ?? query.accountId ?? options.accountId)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      if (body.paperSmokeAuthorized === true) evaluateSensitiveAction({ tenantContext, membership, accountId, action: 'release-acceptance-smoke', allowedRoles: ['owner', 'admin'] })
      const result = createReleaseAcceptanceRun({ ...options, ...body, suiteType, tenantContext, accountId }, { emitEvent: false, signingSecret: options.releaseSigningSecret })
      const saved = await repository.create?.(result.releaseAcceptanceRun)
      for (const check of result.releaseAcceptanceChecks ?? []) {
        await repository.createCheck?.({ ...check, id: `${result.releaseAcceptanceRun.id}-${check.id}`, tenantScope: result.releaseAcceptanceRun.tenantScope, accountId, releaseCandidateId: result.releaseAcceptanceRun.releaseCandidateId, runId: result.releaseAcceptanceRun.id })
      }
      return { event: apiFoundationEvent({ requestId, endpoint: 'release-acceptance', status: result.releaseAcceptanceRun.runState }), releaseAcceptance: { ...result, persisted: saved?.ok }, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const runs = await repository.list?.({ tenantContext, accountId, releaseCandidateId: query.releaseCandidateId, suiteType, runState: query.runState, limit: query.limit }) ?? []
    return { event: apiFoundationEvent({ requestId, endpoint: 'release-acceptance', status: 'ok' }), releaseAcceptanceRuns: runs, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'release-acceptance', ...options })
}

export const handler = createReleaseAcceptanceHandler()
