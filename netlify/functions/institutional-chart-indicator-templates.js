import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { createInstitutionalChartIndicatorTemplateRepository, prepareInstitutionalChartIndicatorTemplate } from '../../lib/system/institutionalChartIndicatorTemplateEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertChartAccess(membership) {
  if (!['owner', 'admin', 'analyst'].includes(membership?.role)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Institutional chart indicator template access denied', { statusCode: 403, publicMessage: 'Institutional chart indicator template access denied' })
}

export function createInstitutionalChartIndicatorTemplatesHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, body, query, membership, tenantContext, event }) => {
    assertChartAccess(membership)
    const repository = options.institutionalChartIndicatorTemplateRepository ?? createInstitutionalChartIndicatorTemplateRepository(options)
    if (String(event.httpMethod ?? 'GET').toUpperCase() === 'POST') {
      const persistence = await repository.create({ ...body.config, tenantContext, evaluatedByUserId: tenantContext.userId })
      return { event: apiFoundationEvent({ requestId, endpoint: 'institutional-chart-indicator-templates', status: persistence.ok ? 'prepared' : 'blocked' }), config: persistence.config, chartingOnly: true, paperTrading: true, liveOrders: false, brokerExecution: false }
    }
    const existing = await repository.list?.({ tenantContext, indicatorTemplateStatus: query.indicatorTemplateStatus, limit: query.limit }) ?? []
    const institutionalChartIndicatorTemplate = prepareInstitutionalChartIndicatorTemplate({ tenantContext, institutionalChartIndicatorTemplates: existing, institutionalChartWorkspace: options.institutionalChartWorkspace, institutionalChartDrawingInteraction: options.institutionalChartDrawingInteraction }, { emitEvent: false })
    return { event: apiFoundationEvent({ requestId, endpoint: 'institutional-chart-indicator-templates', status: institutionalChartIndicatorTemplate.institutionalChartIndicatorTemplateStatus }), institutionalChartIndicatorTemplate, chartingOnly: true, paperTrading: true, liveOrders: false, brokerExecution: false }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'paperTrading.read', workspaceAction: 'read', routeId: 'institutional-chart-indicator-templates', ...options })
}

export const handler = createInstitutionalChartIndicatorTemplatesHandler()
