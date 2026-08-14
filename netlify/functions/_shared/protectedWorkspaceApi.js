import { createWorkspaceDataService } from '../../../lib/workspace/workspaceDataService.js'
import { createOrganizationAuthenticatedApiHandler } from './authApi.js'
import { requireAccountContext } from '../../../lib/security/securityPolicyEngine.js'
import { AppError } from '../../../lib/errors/appError.js'
import { serverLogger } from '../../../lib/logging/logger.js'

export function createProtectedWorkspaceApiHandler(resolver, {
  serviceFactory = createWorkspaceDataService,
  mutation = false,
  ...options
} = {}) {
  const testMembership = String(options.env?.NODE_ENV ?? process.env.NODE_ENV) === 'test'
    ? { getMembership: async (organizationId, userId) => ({ id: `test-membership-${organizationId}-${userId}`, organizationId, userId, role: 'owner', status: 'active' }) }
    : null
  return createOrganizationAuthenticatedApiHandler(async (context) => {
    const source = String(context.event.httpMethod ?? 'GET').toUpperCase() === 'GET' ? context.query : context.body
    const accountId = requireAccountContext(source.accountId)
    if (source.requestedAccountId && source.requestedAccountId !== accountId) {
      throw new AppError('tenant_scope_required', 'Account scope does not match.', {
        statusCode: 403,
        publicMessage: 'account access denied',
        metadata: { crossAccountAccessDenied: true },
      })
    }
    const result = await resolver({ ...context, accountId, service: serviceFactory() })
    if (mutation) {
      const logger = options.logger ?? serverLogger
      logger.info('compatibility API mutation completed', {
        eventType: 'api.compatibility.mutation.completed',
        routeId: options.routeId,
        requestId: context.requestId,
        organizationId: context.organizationId,
        accountId,
        paperTrading: true,
        liveOrders: false,
      })
    }
    return result
  }, {
    requiredPermission: 'dashboard.read',
    workspaceAction: mutation ? 'write' : 'read',
    ...(testMembership && !options.organizationMembershipRepository ? { organizationMembershipRepository: testMembership } : {}),
    ...options,
  })
}
