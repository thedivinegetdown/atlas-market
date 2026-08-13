import { AppError } from '../../lib/errors/appError.js'
import { validateAlertPayload } from '../../lib/alerts/alertValidator.js'
import { createWorkspaceDataService } from '../../lib/workspace/workspaceDataService.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'
import { durableScope, durableWorkspaceRepository, loadDurablePaperProjection } from './_shared/durablePaperWorkspace.js'

export function createAlertConfigurationsHandler({ durableRepository, ledgerRepository, serviceFactory = createWorkspaceDataService, env = process.env, ...options } = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ event, query, body, tenantContext, user, membership, repository }) => {
    const source = event.httpMethod === 'GET' ? query : body
    const input = durableScope({ accountId: source.accountId, tenantContext, user })
    const state = durableWorkspaceRepository({ repository, durableRepository, env })
    const alerts = await state.listAlerts(input)
    if (event.httpMethod === 'GET') return { paperTrading: true, alerts, canonicalDurableSource: true }
    if (!['owner', 'admin'].includes(membership.role)) throw new AppError('alert_write_forbidden', 'Alert configuration mutation requires workspace administration.', { statusCode: 403, publicMessage: 'forbidden' })

    const action = String(body.action ?? '').toLowerCase()
    if (action === 'evaluate') {
      const { projection } = await loadDurablePaperProjection({ accountId: input.accountId, tenantContext, user, repository, ledgerRepository, env })
      return serviceFactory().evaluateAlerts(body.context ?? {}, alerts, projection.summary)
    }
    if (action === 'delete') return { paperTrading: true, deleted: await state.deleteAlert(input, String(body.id ?? '').trim()) }
    if (!['create', 'update'].includes(action)) throw new AppError('invalid_alert_action', 'Alert action is invalid.', { statusCode: 400, publicMessage: 'alert action is invalid' })
    const existing = action === 'update' ? alerts.find((item) => item.id === body.id) : null
    if (action === 'update' && !existing) throw new AppError('alert_not_found', 'Alert was not found.', { statusCode: 404, publicMessage: 'alert was not found' })
    const validation = validateAlertPayload({ ...(existing ?? {}), ...(body.alert ?? body.payload ?? {}) })
    if (!validation.ok) return { ok: false, statusCode: 400, error: validation.error }
    const alert = await state.saveAlert(input, { ...validation.alert, ...(existing ? { id: existing.id, createdAt: existing.createdAt } : {}) })
    return { paperTrading: true, alert, canonicalDurableSource: true }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'alert-configurations', env, ...options })
}

export const handler = createAlertConfigurationsHandler()
