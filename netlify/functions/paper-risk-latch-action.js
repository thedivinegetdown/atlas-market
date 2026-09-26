import { AppError } from '../../lib/errors/appError.js'
import { resolveCanonicalPaperLedgerRepository } from '../../lib/opportunities/persistence/canonicalPaperLedgerRepository.js'
import { requireAccountContext } from '../../lib/security/securityPolicyEngine.js'
import { createOrganizationAuthenticatedApiHandler } from './_shared/authApi.js'

function requirePrivilegedHuman(membership = {}) {
  if (!['owner', 'admin'].includes(membership.role)) {
    throw new AppError('paper_risk_latch_action_denied', 'PAPER risk latch actions require owner/admin authority.', {
      statusCode: 403,
      publicMessage: 'paper risk latch action denied',
    })
  }
  return membership.role
}

export function createPaperRiskLatchActionHandler({ ledgerRepository: providedLedgerRepository, env = process.env, ...options } = {}) {
  return createOrganizationAuthenticatedApiHandler(async ({ body, membership, tenantContext, user, repository }) => {
    const role = requirePrivilegedHuman(membership)
    const action = String(body.action ?? '').trim().toUpperCase()
    if (!['KILL', 'RESET'].includes(action)) {
      throw new AppError('paper_risk_latch_action_invalid', 'PAPER risk latch action must be KILL or RESET.', {
        statusCode: 400,
        publicMessage: 'paper risk latch action is invalid',
      })
    }
    const accountId = requireAccountContext(body.accountId ?? 'paper-portfolio')
    const ledger = resolveCanonicalPaperLedgerRepository({
      persistenceRepository: repository,
      ledgerRepository: providedLedgerRepository,
      env,
    })
    const command = {
      tenantContext,
      accountId,
      userId: tenantContext.userId ?? user.id,
      action,
      reason: body.reason,
      expectedRevision: body.expectedRevision,
      confirmed: body.confirmed === true,
      actor: {
        userId: user.id,
        role,
        source: 'authenticated_human_request',
      },
    }
    const result = action === 'KILL'
      ? await ledger.activateRiskLatch(command)
      : await ledger.resetRiskLatch(command)
    return {
      riskLatch: result.latch,
      audit: result.audit,
      action: result.action,
      paperTradingOnly: true,
      liveOrders: false,
      brokerExecution: false,
    }
  }, {
    allowedMethods: ['POST'],
    requiredPermission: 'dashboard.read',
    workspaceAction: 'write',
    routeId: 'paper-risk-latch-action',
    maxRequestBytes: 8 * 1024,
    env,
    ...options,
  })
}

export const handler = createPaperRiskLatchActionHandler()
