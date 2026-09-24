import { resolveCanonicalPaperLedgerRepository } from '../../../lib/opportunities/persistence/canonicalPaperLedgerRepository.js'
import { buildDurablePaperWorkflowProjections, resolveDurableWorkspaceStateRepository } from '../../../lib/persistence/durablePaperWorkflowProjections.js'
import { requireAccountContext } from '../../../lib/security/securityPolicyEngine.js'

export function durableScope({ accountId, tenantContext, user }) {
  return {
    tenantContext,
    accountId: requireAccountContext(accountId ?? 'paper-portfolio'),
    userId: tenantContext.userId ?? user.id,
  }
}

export async function loadDurablePaperProjection({ accountId, tenantContext, user, repository, ledgerRepository, env, asOf }) {
  const input = durableScope({ accountId, tenantContext, user })
  const ledger = resolveCanonicalPaperLedgerRepository({ persistenceRepository: repository, ledgerRepository, env })
  const [{ account, positions }, executionHistory] = await Promise.all([
    ledger.getOrCreateAccount(input),
    typeof ledger.readExecutionHistory === 'function'
      ? ledger.readExecutionHistory(input)
      : ledger.listExecutions(input).then((executions) => ({ executions, history: { status: 'UNKNOWN', returnedCount: executions.length, latest: null } })),
  ])
  return { input, projection: buildDurablePaperWorkflowProjections({ account, positions, executions: executionHistory.executions, history: executionHistory.history, asOf }) }
}

export function durableWorkspaceRepository({ repository, durableRepository, env }) {
  return resolveDurableWorkspaceStateRepository({ persistenceRepository: repository, durableRepository, env })
}
