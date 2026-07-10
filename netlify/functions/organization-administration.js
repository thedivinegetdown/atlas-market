import { updateOrganizationAdministration } from '../../lib/auth/administrationService.js'
import { createOrganizationRepository } from '../../lib/auth/organizationRepository.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

export function createOrganizationAdministrationHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, organizationId, body, membership, repository }) => {
    const result = await updateOrganizationAdministration({
      action: body.action ?? 'profile-update',
      organizationId,
      requestedOrganizationId: body.requestedOrganizationId ?? organizationId,
      actorMembership: membership,
      organization: {
        id: organizationId,
        name: body.name,
        status: body.status ?? 'active',
        metadata: body.metadata,
      },
      activeOwnerCount: body.activeOwnerCount,
      targetUserId: body.targetUserId,
      targetRole: body.targetRole,
    }, {
      organizationRepository: options.organizationRepository ?? createOrganizationRepository(options),
      emitEvent: false,
    })
    await repository.getStore('enterpriseAuditRecords')?.upsert?.(result.auditRecord.id, result.auditRecord)
    return {
      event: apiFoundationEvent({ requestId, endpoint: 'organization-administration' }),
      result,
      paperTrading: true,
      liveOrders: false,
      brokerExecution: false,
      billingEnabled: false,
    }
  }, {
    allowedMethods: ['POST'],
    requiredPermission: 'workspace.admin',
    workspaceAction: 'administer',
    routeId: 'organization-administration',
    ...options,
  })
}

export const handler = createOrganizationAdministrationHandler()
