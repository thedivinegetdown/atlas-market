import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createPaperReportRepository, generatePaperTradingReport } from '../../lib/reports/paperTradingReportingEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertAccess(membership, method) {
  const role = membership?.role
  if (String(method).toUpperCase() === 'GET' && ['owner', 'admin', 'analyst', 'viewer'].includes(role)) return
  if (['owner', 'admin', 'analyst'].includes(role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Paper report access denied', { statusCode: 403, publicMessage: 'paper report access denied' })
}

export function createPaperReportsHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertAccess(membership, event.httpMethod)
    const repository = options.paperReportRepository ?? createPaperReportRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const report = generatePaperTradingReport({ ...options, ...body, tenantContext, accountId: body.accountId ?? options.accountId ?? query.accountId }, { emitEvent: false })
      const saved = await repository.create?.(report.paperReport)
      return { event: apiFoundationEvent({ requestId, endpoint: 'paper-reports', status: report.reportStatus }), paperReport: { ...report, persisted: saved?.ok }, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const reports = await repository.list?.({ tenantContext, accountId: query.accountId ?? options.accountId, reportType: query.reportType, limit: query.limit }) ?? []
    return { event: apiFoundationEvent({ requestId, endpoint: 'paper-reports', status: 'ok' }), paperReports: reports, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'paper-reports', ...options })
}

export const handler = createPaperReportsHandler()
