import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'
import { requireAccountContext } from '../../lib/security/securityPolicyEngine.js'

export function createOperatorActionsHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ repository, query, requestId, tenantContext, user }) => {
    const accountId = requireAccountContext(query.accountId)
    const rows = (await repository.getStore('operatorActions').listScoped({ organizationId: tenantContext.organizationId, teamWorkspaceId: tenantContext.teamWorkspaceId, userId: tenantContext.userId ?? user.id, limit: query.limit })).filter((row) => row.payload?.accountId === accountId)
    return {
      paperTrading: true,
      operatorActions: rows,
      event: apiFoundationEvent({ requestId, endpoint: 'operator-actions:read' }),
    }
  }, { requiredPermission: 'dashboard.read', workspaceAction: 'read', routeId: 'operator-actions', ...options })
}

export const handler = createOperatorActionsHandler()
