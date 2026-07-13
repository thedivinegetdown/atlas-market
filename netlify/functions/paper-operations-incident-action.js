import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createPaperOperationsIncidentRepository, transitionPaperOperationsIncident } from '../../lib/trading/paperOperationsIncidentManagementEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertWrite(membership) {
  if (['owner', 'admin', 'analyst'].includes(membership?.role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Paper operations incident action denied', { statusCode: 403, publicMessage: 'paper operations incident action denied' })
}

export function createPaperOperationsIncidentActionHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, membership, tenantContext, user }) => {
    assertWrite(membership)
    const result = transitionPaperOperationsIncident({
      incident: { ...(body.incident ?? {}), id: body.incidentId ?? body.incident?.id, tenantContext, accountId: body.accountId ?? options.accountId },
      nextState: body.nextState,
      actor: { userId: user.id, role: membership.role },
      reason: body.reason,
    })
    if (result.rejected) throw new AppError(ERROR_CODES.VALIDATION_ERROR, result.reason, { statusCode: 400, publicMessage: 'invalid incident transition' })
    const repository = options.paperOperationsIncidentRepository ?? createPaperOperationsIncidentRepository(options)
    const saved = await repository.upsert?.(result.incident)
    await repository.appendActivity?.(result.incident, result.incident.activityRecords.at(-1))
    return { event: apiFoundationEvent({ requestId, endpoint: 'paper-operations-incident-action', status: result.incident.incidentState }), paperOperationsIncident: saved?.incident ?? result.incident, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'paper-operations-incident-action', ...options })
}

export const handler = createPaperOperationsIncidentActionHandler()
