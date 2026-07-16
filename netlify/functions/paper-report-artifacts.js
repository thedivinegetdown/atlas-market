import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createPaperReportArtifactRepository } from '../../lib/reports/paperReportArtifactEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertAccess(membership) {
  const role = membership?.role
  if (['owner', 'admin', 'analyst', 'viewer'].includes(role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Paper report artifact access denied', { statusCode: 403, publicMessage: 'paper report artifact access denied' })
}

export function createPaperReportArtifactsHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, query, membership, tenantContext }) => {
    assertAccess(membership)
    const repository = options.paperReportArtifactRepository ?? createPaperReportArtifactRepository(options)
    const artifacts = await repository.list?.({ tenantContext, accountId: query.accountId ?? options.accountId, status: query.status, limit: query.limit }) ?? []
    return { event: apiFoundationEvent({ requestId, endpoint: 'paper-report-artifacts', status: 'ok' }), paperReportArtifacts: artifacts, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'paper-report-artifacts', ...options })
}

export const handler = createPaperReportArtifactsHandler()
