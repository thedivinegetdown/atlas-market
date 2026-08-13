import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'
import { requireAccountContext } from '../../lib/security/securityPolicyEngine.js'

export function createSystemEventsHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ repository, query, requestId, tenantContext, user }) => {
    const accountId = requireAccountContext(query.accountId)
    const rows = (await repository.getStore('systemEvents').listScoped({ organizationId: tenantContext.organizationId, teamWorkspaceId: tenantContext.teamWorkspaceId, userId: tenantContext.userId ?? user.id, limit: query.limit })).filter((row) => row.payload?.accountId === accountId)
    return {
      paperTrading: true,
      systemEvents: rows,
      event: apiFoundationEvent({ requestId, endpoint: 'system-events:read' }),
    }
  }, { requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'system-events', ...options })
}

export const handler = createSystemEventsHandler()
