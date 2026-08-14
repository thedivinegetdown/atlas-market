import { sanitizeId, validateObjectPayload, apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'
import { requireAccountContext } from '../../lib/security/securityPolicyEngine.js'
import { AppError } from '../../lib/errors/appError.js'

export function createWorkspaceConfigurationsHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ repository, query, body, requestId, event, tenantContext, user, membership }) => {
    const source = event.httpMethod === 'POST' ? body : query
    const accountId = requireAccountContext(source.accountId)
    const scope = { organizationId: tenantContext.organizationId, teamWorkspaceId: tenantContext.teamWorkspaceId, userId: tenantContext.userId ?? user.id }
    const store = repository.getStore('workspaceConfigurations')
    if (event.httpMethod === 'POST') {
      if (!['owner', 'admin'].includes(membership.role)) throw new AppError('authorization_denied', 'Workspace configuration mutation requires administration.', { statusCode: 403, publicMessage: 'forbidden' })
      const id = sanitizeId(body.id)
      const payload = validateObjectPayload(body.payload)
      const existing = await store.getScoped(id, scope)
      if (existing?.payload?.accountId && existing.payload.accountId !== accountId) throw new AppError('tenant_scope_required', 'Workspace configuration account scope does not match.', { statusCode: 403, publicMessage: 'workspace access denied' })
      const result = await store.upsertScoped(id, { ...payload, accountId }, scope)
      return {
        paperTrading: true,
        result,
        event: apiFoundationEvent({ requestId, endpoint: 'workspace-configurations:write' }),
      }
    }

    const rows = (await store.listScoped({ ...scope, limit: query.limit })).filter((row) => row.payload?.accountId === accountId)
    return {
      paperTrading: true,
      workspaceConfigurations: rows,
      event: apiFoundationEvent({ requestId, endpoint: 'workspace-configurations:read' }),
    }
  }, { allowedMethods: ['GET', 'POST'], requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'workspace-configurations', ...options })
}

export const handler = createWorkspaceConfigurationsHandler()
