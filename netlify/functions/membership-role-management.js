import { updateOrganizationAdministration, updateTeamWorkspaceAdministration } from '../../lib/auth/administrationService.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createTeamAuthenticatedApiHandler } from './_shared/authApi.js'

export function createMembershipRoleManagementHandler(options = {}) {
  return createTeamAuthenticatedApiHandler(async ({ requestId, body, organizationId, membership, teamWorkspace, teamMembership, repository }) => {
    const scope = body.scope ?? 'organization'
    const result = scope === 'team'
      ? await updateTeamWorkspaceAdministration({
        action: 'team-membership-role-update',
        actorMembership: membership,
        teamWorkspace,
        teamMembership,
        userId: body.userId,
        role: body.role,
      }, {
        teamMembershipRepository: options.teamMembershipRepository,
        emitEvent: false,
      })
      : await updateOrganizationAdministration({
        action: 'membership-role-update',
        organizationId,
        requestedOrganizationId: body.requestedOrganizationId ?? organizationId,
        actorMembership: membership,
        currentMembership: body.currentMembership,
        userId: body.userId,
        role: body.role,
        activeOwnerCount: body.activeOwnerCount,
      }, {
        membershipRepository: options.organizationMembershipRepository,
        emitEvent: false,
      })
    await repository.getStore('enterpriseAuditRecords')?.upsert?.(result.auditRecord.id, result.auditRecord)
    return {
      event: apiFoundationEvent({ requestId, endpoint: 'membership-role-management' }),
      result,
      paperTrading: true,
      liveOrders: false,
      brokerExecution: false,
      billingEnabled: false,
    }
  }, {
    allowedMethods: ['POST'],
    requiredPermission: 'workspace.admin',
    teamAction: 'administer',
    routeId: 'membership-role-management',
    ...options,
  })
}

export const handler = createMembershipRoleManagementHandler()
