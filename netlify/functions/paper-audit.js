import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createPaperAuditRepository, generatePaperAuditReport } from '../../lib/reports/paperAuditReportingEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertAccess(membership, method) {
  const role = membership?.role
  if (String(method).toUpperCase() === 'GET' && ['owner', 'admin', 'analyst', 'viewer'].includes(role)) return
  if (['owner', 'admin', 'analyst'].includes(role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Paper audit access denied', { statusCode: 403, publicMessage: 'paper audit access denied' })
}

export function createPaperAuditHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertAccess(membership, event.httpMethod)
    const repository = options.paperAuditRepository ?? createPaperAuditRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const audit = generatePaperAuditReport({ ...options, ...body, tenantContext, accountId: body.accountId ?? options.accountId ?? query.accountId }, { emitEvent: false })
      const saved = await repository.create?.(audit.paperAuditReport)
      return { event: apiFoundationEvent({ requestId, endpoint: 'paper-audit', status: audit.auditStatus }), paperAudit: { ...audit, persisted: saved?.ok }, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const audits = await repository.list?.({ tenantContext, accountId: query.accountId ?? options.accountId, limit: query.limit }) ?? []
    return { event: apiFoundationEvent({ requestId, endpoint: 'paper-audit', status: 'ok' }), paperAudits: audits, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'paper-audit', ...options })
}

export const handler = createPaperAuditHandler()
