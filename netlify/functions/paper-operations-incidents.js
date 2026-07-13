import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createPaperOperationsIncidentRepository, openPaperOperationsIncidents } from '../../lib/trading/paperOperationsIncidentManagementEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertAccess(membership, method) {
  const role = membership?.role
  if (String(method).toUpperCase() === 'GET' && ['owner', 'admin', 'analyst', 'viewer'].includes(role)) return
  if (['owner', 'admin', 'analyst'].includes(role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Paper operations incident access denied', { statusCode: 403, publicMessage: 'paper operations incident access denied' })
}

export function createPaperOperationsIncidentsHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertAccess(membership, event.httpMethod)
    const repository = options.paperOperationsIncidentRepository ?? createPaperOperationsIncidentRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const result = openPaperOperationsIncidents({ ...options, ...body, tenantContext, accountId: body.accountId ?? options.accountId ?? query.accountId }, { emitEvent: false })
      for (const incident of result.paperOperationsIncidents) {
        await repository.upsert?.(incident)
        for (const alertId of incident.linkedAlertIds) await repository.linkAlert?.(incident, { id: alertId })
      }
      return { event: apiFoundationEvent({ requestId, endpoint: 'paper-operations-incidents', status: result.incidentWorkflowStatus }), paperOperationsIncidents: result, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const incidents = await repository.list?.({ tenantContext, accountId: query.accountId ?? options.accountId, incidentState: query.incidentState, priority: query.priority, limit: query.limit }) ?? []
    return { event: apiFoundationEvent({ requestId, endpoint: 'paper-operations-incidents', status: 'ok' }), paperOperationsIncidents: incidents, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'paper-operations-incidents', ...options })
}

export const handler = createPaperOperationsIncidentsHandler()
