import { updateTeamWorkspaceAdministration } from '../../lib/auth/administrationService.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createTeamAuthenticatedApiHandler } from './_shared/authApi.js'

export function createTeamWorkspaceAdministrationHandler(options = {}) {
  return createTeamAuthenticatedApiHandler(async ({ requestId, body, membership, teamWorkspace, teamMembership, repository }) => {
    const result = await updateTeamWorkspaceAdministration({
      action: body.action ?? 'team-profile-update',
      actorMembership: membership,
      teamWorkspace,
      teamMembership,
      updates: body.updates ?? { name: body.name, metadata: body.metadata },
    }, {
      teamWorkspaceRepository: options.teamWorkspaceRepository,
      teamMembershipRepository: options.teamMembershipRepository,
      emitEvent: false,
    })
    await repository.getStore('enterpriseAuditRecords')?.upsert?.(result.auditRecord.id, result.auditRecord)
    return {
      event: apiFoundationEvent({ requestId, endpoint: 'team-workspace-administration' }),
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
    routeId: 'team-workspace-administration',
    ...options,
  })
}

export const handler = createTeamWorkspaceAdministrationHandler()
