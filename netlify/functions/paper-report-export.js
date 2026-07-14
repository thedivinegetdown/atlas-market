import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { exportPaperReport, createPaperReportExportRepository } from '../../lib/reports/paperReportExportEngine.js'
import { generatePaperTradingReport } from '../../lib/reports/paperTradingReportingEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertAccess(membership, method) {
  const role = membership?.role
  if (String(method).toUpperCase() === 'GET' && ['owner', 'admin', 'analyst', 'viewer'].includes(role)) return
  if (['owner', 'admin', 'analyst'].includes(role)) return
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Paper report export access denied', { statusCode: 403, publicMessage: 'paper report export access denied' })
}

export function createPaperReportExportHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertAccess(membership, event.httpMethod)
    const repository = options.paperReportExportRepository ?? createPaperReportExportRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const report = body.paperReport ?? generatePaperTradingReport({ ...options, ...body, tenantContext, accountId: body.accountId ?? options.accountId ?? query.accountId }, { emitEvent: false }).paperReport
      const exported = exportPaperReport({ ...body, tenantContext, paperReport: report }, { emitEvent: false })
      const saved = await repository.create?.(exported.paperReportExport)
      return { event: apiFoundationEvent({ requestId, endpoint: 'paper-report-export', status: exported.exportStatus }), paperReportExport: { ...exported, persisted: saved?.ok }, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const exports = await repository.list?.({ tenantContext, accountId: query.accountId ?? options.accountId, reportType: query.reportType, limit: query.limit }) ?? []
    return { event: apiFoundationEvent({ requestId, endpoint: 'paper-report-export', status: 'ok' }), paperReportExports: exports, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'paper-report-export', ...options })
}

export const handler = createPaperReportExportHandler()
