import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationRepository } from '../../lib/auth/organizationRepository.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

export function createCurrentOrganizationHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, organizationId, repository, membership, workspaceAccess }) => {
    const organizationRepository = options.organizationRepository ?? createOrganizationRepository()
    const organization = await organizationRepository.getOrganization?.(organizationId)
    return {
      event: apiFoundationEvent({ requestId, endpoint: 'current-organization' }),
      organization: organization ?? { id: organizationId, status: 'active' },
      membership,
      workspaceAccess: workspaceAccess.accessStatus,
      paperTrading: true,
      liveOrders: false,
      brokerExecution: false,
      billingEnabled: false,
      repositoryConnected: repository.connected === true,
    }
  }, {
    allowedMethods: ['GET'],
    requiredPermission: 'dashboard.read',
    workspaceAction: 'read',
    routeId: 'current-organization',
    ...options,
  })
}

export const handler = createCurrentOrganizationHandler()
