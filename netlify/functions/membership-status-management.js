import { updateOrganizationAdministration, updateTeamWorkspaceAdministration } from '../../lib/auth/administrationService.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createTeamAuthenticatedApiHandler } from './_shared/authApi.js'

export function createMembershipStatusManagementHandler(options = {}) {
  return createTeamAuthenticatedApiHandler(async ({ requestId, body, organizationId, membership, teamWorkspace, teamMembership, repository }) => {
    const scope = body.scope ?? 'organization'
    const statusAction = body.status === 'active' ? 'reactivate' : 'suspend'
    const result = scope === 'team'
      ? await updateTeamWorkspaceAdministration({
        action: `team-membership-${statusAction}`,
        actorMembership: membership,
        teamWorkspace,
        teamMembership,
        userId: body.userId,
        role: body.role,
        membershipId: body.membershipId,
      }, {
        teamMembershipRepository: options.teamMembershipRepository,
        emitEvent: false,
      })
      : await updateOrganizationAdministration({
        action: `membership-${statusAction}`,
        organizationId,
        requestedOrganizationId: body.requestedOrganizationId ?? organizationId,
        actorMembership: membership,
        userId: body.userId,
        role: body.role,
        membershipId: body.membershipId,
      }, {
        membershipRepository: options.organizationMembershipRepository,
        emitEvent: false,
      })
    await repository.getStore('enterpriseAuditRecords')?.upsert?.(result.auditRecord.id, result.auditRecord)
    return {
      event: apiFoundationEvent({ requestId, endpoint: 'membership-status-management' }),
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
    routeId: 'membership-status-management',
    ...options,
  })
}

export const handler = createMembershipStatusManagementHandler()
