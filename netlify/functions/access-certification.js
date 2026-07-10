import { AppError, ERROR_CODES } from '../../lib/errors/appError.js'
import { evaluateAccessCertification } from '../../lib/system/accessCertificationEngine.js'
import { apiFoundationEvent } from './_shared/persistenceApi.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function assertOwnerAdmin(membership) {
  if (!['owner', 'admin'].includes(membership?.role)) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'access certification denied', {
      statusCode: 403,
      publicMessage: 'access certification denied',
    })
  }
}

export function createAccessCertificationHandler(options = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ requestId, membership }) => {
    assertOwnerAdmin(membership)
    const certification = evaluateAccessCertification({
      accessReview: options.accessReview,
      administrativeAudit: options.administrativeAudit,
      collaborationGovernance: options.collaborationGovernance,
      sessionSecurity: options.sessionSecurity,
      operatorActions: options.operatorActions,
      organizationMemberships: options.organizationMemberships ?? [membership],
      teamMemberships: options.teamMemberships ?? [],
      sessions: options.sessions ?? [],
      invitations: options.invitations ?? [],
    }, { emitEvent: false })
    return {
      event: apiFoundationEvent({ requestId, endpoint: 'access-certification', status: certification.certificationStatus }),
      certification,
      automaticAccessRevocation: false,
      automaticRoleChanges: false,
      automaticSessionRevocation: false,
      tokenHashesExposed: false,
      invitationHashesExposed: false,
      sensitiveSessionMaterialExposed: false,
      paperTrading: true,
      liveOrders: false,
      brokerExecution: false,
    }
  }, {
    allowedMethods: ['GET'],
    requiredPermission: 'workspace.admin',
    workspaceAction: 'administer',
    routeId: 'access-certification',
    ...options,
  })
}

export const handler = createAccessCertificationHandler()
