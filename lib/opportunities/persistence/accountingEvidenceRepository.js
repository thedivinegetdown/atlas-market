import { randomUUID } from 'node:crypto'
import { AppError } from '../../errors/appError.js'

export const ACCOUNTING_RECONCILIATION_STATUS = Object.freeze({
  complete: 'COMPLETE',
  incomplete: 'INCOMPLETE',
  unavailable: 'UNAVAILABLE',
})

export const ACCOUNTING_EVIDENCE_ERRORS = Object.freeze({
  unavailable: 'paper_accounting_evidence_unavailable',
  invalidScope: 'paper_accounting_evidence_tenant_scope_invalid',
  invalidRequest: 'paper_external_funding_request_invalid',
  authorityDenied: 'paper_external_funding_authority_denied',
  conflict: 'paper_external_funding_conflict',
  insufficientFunds: 'paper_external_funding_insufficient_funds',
  accountMissing: 'paper_external_funding_account_missing',
})

const EXTERNAL_EVENT_KINDS = new Set([
  'OPENING_FUNDING',
  'EXTERNAL_DEPOSIT',
  'EXTERNAL_WITHDRAWAL',
  'EXTERNAL_REVERSAL',
  'EXTERNAL_REPLACEMENT',
])

const FORBIDDEN_REQUEST_FIELDS = Object.freeze([
  'cash', 'cashBefore', 'cashAfter', 'equity', 'buyingPower', 'cumulativeFunding',
  'accountRevision', 'accountRevisionBefore', 'accountRevisionAfter', 'accountingOriginId', 'createdAt',
  'updatedAt', 'timestamp', 'actor', 'actorUserId', 'actorRole', 'authoritySource',
  'cash_before', 'cash_after', 'buying_power', 'cumulative_funding', 'account_revision',
  'account_revision_before', 'account_revision_after', 'accounting_origin_id', 'created_at', 'updated_at',
  'actor_user_id', 'actor_role', 'authority_source', 'userId', 'role', 'source',
])

function evidenceError(code, detail, statusCode = 409, publicMessage = 'paper accounting evidence is unavailable') {
  return new AppError(code, detail, {
    statusCode,
    publicMessage,
    metadata: { paperTradingOnly: true, liveOrders: false, brokerExecution: false },
  })
}

function normalizedScope(input = {}) {
  const tenant = input.tenantContext ?? input.tenantScope ?? {}
  const scope = {
    organizationId: String(tenant.organizationId ?? '').trim(),
    teamWorkspaceId: String(tenant.teamWorkspaceId ?? '').trim(),
    accountId: String(input.accountId ?? '').trim(),
    userId: String(input.userId ?? tenant.userId ?? '').trim(),
  }
  if (!scope.organizationId || !scope.accountId || !scope.userId) {
    throw evidenceError(ACCOUNTING_EVIDENCE_ERRORS.invalidScope, 'Organization, account, and user scope are required.', 403, 'paper accounting tenant scope is invalid')
  }
  return scope
}

function finite(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function money(value, label = 'amount') {
  const number = finite(value)
  if (number == null || number === 0 || !Number.isSafeInteger(Math.round(number * 100)) || Math.abs((number * 100) - Math.round(number * 100)) > 1e-7) {
    throw evidenceError(ACCOUNTING_EVIDENCE_ERRORS.invalidRequest, `${label} must be a non-zero finite amount with at most two decimal places.`, 400, 'external funding amount is invalid')
  }
  return Math.round(number * 100) / 100
}

function rounded(value) {
  return Math.round(Number(value) * 100) / 100
}

function requireIdempotencyKey(value) {
  const key = String(value ?? '').trim()
  if (key.length < 8 || key.length > 200) {
    throw evidenceError(ACCOUNTING_EVIDENCE_ERRORS.invalidRequest, 'An idempotency key between 8 and 200 characters is required.', 400, 'external funding idempotency key is invalid')
  }
  return key
}

function assertRequestBoundary(request = {}) {
  const forbidden = FORBIDDEN_REQUEST_FIELDS.filter((field) => Object.prototype.hasOwnProperty.call(request, field))
  if (forbidden.length) {
    throw evidenceError(ACCOUNTING_EVIDENCE_ERRORS.invalidRequest, `Funding requests cannot supply authoritative fields: ${forbidden.join(', ')}.`, 400, 'external funding request contains authoritative fields')
  }
}

function authenticatedHumanAuthority(authority = {}, scope) {
  const source = String(authority.source ?? '')
  const principalType = String(authority.principalType ?? '')
  const userId = String(authority.userId ?? '')
  const role = String(authority.role ?? '')
  if (source !== 'authenticated_human_request' || principalType !== 'human' || !['owner', 'admin'].includes(role) || userId !== scope.userId) {
    throw evidenceError(ACCOUNTING_EVIDENCE_ERRORS.authorityDenied, 'External PAPER funding requires authenticated owner/admin human authority; AI and Copilot authority is prohibited.', 403, 'external funding authority denied')
  }
  return { userId, role, source }
}

function accountFromRow(row = {}) {
  return {
    recordId: row.id,
    organizationId: row.organization_id,
    teamWorkspaceId: row.team_workspace_id,
    accountId: row.account_id,
    userId: row.user_id,
    cash: Number(row.cash),
    buyingPower: Number(row.buying_power),
    equity: Number(row.equity),
    realizedPnl: Number(row.realized_pnl),
    revision: Number(row.revision),
    accountingOriginId: row.accounting_origin_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    paperTradingOnly: true,
  }
}

function evidenceFromRow(row = {}) {
  return {
    evidenceId: row.id,
    accountRecordId: row.account_record_id,
    organizationId: row.organization_id,
    teamWorkspaceId: row.team_workspace_id,
    accountId: row.account_id,
    userId: row.user_id,
    accountingOriginId: row.accounting_origin_id ?? null,
    eventKind: row.event_kind,
    amount: Number(row.amount),
    cashBefore: Number(row.cash_before),
    cashAfter: Number(row.cash_after),
    accountRevisionBefore: Number(row.account_revision_before),
    accountRevisionAfter: Number(row.account_revision_after),
    linkedEvidenceId: row.linked_evidence_id ?? null,
    executionId: row.execution_id ?? null,
    idempotencyKey: row.operation_idempotency_key,
    operationIndex: Number(row.operation_index),
    actorUserId: row.actor_user_id,
    actorRole: row.actor_role,
    authoritySource: row.authority_source,
    createdAt: row.created_at,
    paperTradingOnly: true,
  }
}

async function insertEvidence(client, {
  account, scope, eventKind, amount, cashBefore, cashAfter, revisionBefore, revisionAfter,
  linkedEvidenceId = null, executionId = null, idempotencyKey, operationIndex = 0,
  actorUserId, actorRole, authoritySource,
}) {
  const result = await client.query(
    `INSERT INTO atlas_paper_accounting_evidence
      (id,account_record_id,organization_id,team_workspace_id,account_id,user_id,accounting_origin_id,event_kind,amount,cash_before,cash_after,account_revision_before,account_revision_after,linked_evidence_id,execution_id,operation_idempotency_key,operation_index,actor_user_id,actor_role,authority_source,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,clock_timestamp())
     RETURNING *`,
    [randomUUID(), account.id ?? account.recordId, scope.organizationId, scope.teamWorkspaceId, scope.accountId, scope.userId,
      account.accounting_origin_id ?? account.accountingOriginId ?? null, eventKind, amount, cashBefore, cashAfter, revisionBefore, revisionAfter,
      linkedEvidenceId, executionId, idempotencyKey, operationIndex, actorUserId, actorRole, authoritySource],
  )
  if (!result.rows?.[0]) throw evidenceError(ACCOUNTING_EVIDENCE_ERRORS.conflict, 'Accounting evidence was not persisted.')
  return evidenceFromRow(result.rows[0])
}

export async function appendOpeningFundingEvidence(client, { account, scope, amount }) {
  if (!account?.accounting_origin_id) {
    throw evidenceError(ACCOUNTING_EVIDENCE_ERRORS.conflict, 'New PAPER account is missing its server-generated accounting origin identity.')
  }
  return insertEvidence(client, {
    account, scope, eventKind: 'OPENING_FUNDING', amount, cashBefore: 0, cashAfter: amount,
    revisionBefore: -1, revisionAfter: 0, idempotencyKey: 'system:canonical-account-opening',
    actorUserId: 'system', actorRole: 'system', authoritySource: 'system_account_creation',
  })
}

export async function appendExecutionAccountingEvidence(client, { accountBefore, accountAfter, scope, execution }) {
  const amount = Number(execution.cash_impact)
  return insertEvidence(client, {
    account: accountAfter, scope, eventKind: 'EXECUTION', amount,
    cashBefore: Number(accountBefore.cash), cashAfter: Number(accountAfter.cash),
    revisionBefore: Number(accountBefore.revision), revisionAfter: Number(accountAfter.revision),
    executionId: execution.id, idempotencyKey: `execution:${execution.id}`,
    actorUserId: scope.userId, actorRole: 'paper_account_user', authoritySource: 'canonical_execution',
  })
}

async function loadAccountForUpdate(client, scope) {
  const result = await client.query(
    `SELECT * FROM atlas_paper_accounts
     WHERE organization_id=$1 AND team_workspace_id=$2 AND account_id=$3 AND user_id=$4
     FOR UPDATE`,
    [scope.organizationId, scope.teamWorkspaceId, scope.accountId, scope.userId],
  )
  if (!result.rows?.[0]) throw evidenceError(ACCOUNTING_EVIDENCE_ERRORS.accountMissing, 'Canonical PAPER account does not exist.', 404, 'paper account does not exist')
  return result.rows[0]
}

async function loadOperation(client, accountRecordId, idempotencyKey) {
  const result = await client.query(
    `SELECT * FROM atlas_paper_accounting_evidence
     WHERE account_record_id=$1 AND operation_idempotency_key=$2
     ORDER BY operation_index ASC`,
    [accountRecordId, idempotencyKey],
  )
  return (result.rows ?? []).map(evidenceFromRow)
}

function assertOperationRetry(rows, expected) {
  if (!rows.length) return false
  if (rows.length !== expected.length || rows.some((row, index) => row.eventKind !== expected[index].eventKind
    || row.amount !== expected[index].amount || row.linkedEvidenceId !== (expected[index].linkedEvidenceId ?? null))) {
    throw evidenceError(ACCOUNTING_EVIDENCE_ERRORS.conflict, 'The idempotency key is already bound to different external funding evidence.', 409, 'external funding idempotency conflict')
  }
  return true
}

async function mutateAccount(client, account, amount) {
  const cash = rounded(Number(account.cash) + amount)
  const buyingPower = rounded(Number(account.buying_power) + amount)
  const equity = rounded(Number(account.equity) + amount)
  if (cash < 0 || buyingPower < 0) {
    throw evidenceError(ACCOUNTING_EVIDENCE_ERRORS.insufficientFunds, 'Withdrawal or correction would make canonical cash or buying power negative; it was rejected without clamping.', 409, 'external withdrawal exceeds available PAPER funds')
  }
  const result = await client.query(
    `UPDATE atlas_paper_accounts
     SET cash=$2,buying_power=$3,equity=$4,revision=revision+1,updated_at=clock_timestamp()
     WHERE id=$1 AND revision=$5 RETURNING *`,
    [account.id, cash, buyingPower, equity, Number(account.revision)],
  )
  if (!result.rows?.[0]) throw evidenceError(ACCOUNTING_EVIDENCE_ERRORS.conflict, 'Canonical PAPER account revision changed during external funding.', 409, 'paper account state changed; retry external funding')
  return result.rows[0]
}

function reconciliationResult(status, account, evidence, reasons = []) {
  const opening = account?.accountingOriginId
    ? evidence.find((row) => row.eventKind === 'OPENING_FUNDING'
      && row.accountingOriginId === account.accountingOriginId
      && row.accountRevisionBefore === -1 && row.accountRevisionAfter === 0
      && row.cashBefore === 0 && rounded(row.amount) === rounded(row.cashAfter)) ?? null
    : null
  const subsequent = evidence.filter((row) => row.eventKind !== 'OPENING_FUNDING')
  const executionCashImpacts = rounded(subsequent.filter((row) => row.eventKind === 'EXECUTION').reduce((sum, row) => sum + row.amount, 0))
  const externalCashFlows = rounded(subsequent.filter((row) => EXTERNAL_EVENT_KINDS.has(row.eventKind)).reduce((sum, row) => sum + row.amount, 0))
  const provenOriginCash = opening?.cashAfter ?? null
  return {
    status,
    reasons,
    account: account ? { recordId: account.recordId, accountId: account.accountId, cash: account.cash, revision: account.revision, accountingOriginId: account.accountingOriginId } : null,
    provenOrigin: opening ? { evidenceId: opening.evidenceId, cash: provenOriginCash, accountRevision: opening.accountRevisionAfter, accountingOriginId: opening.accountingOriginId } : null,
    executionCashImpacts,
    externalCashFlows,
    cumulativeFunding: provenOriginCash == null ? null : rounded(provenOriginCash + externalCashFlows),
    reconstructedCash: provenOriginCash == null ? null : rounded(provenOriginCash + executionCashImpacts + externalCashFlows),
    evidenceCount: evidence.length,
    evidence,
    paperTradingOnly: true,
  }
}

export function createAccountingEvidenceRepository({ database } = {}) {
  if (!database?.connected || typeof database.query !== 'function' || typeof database.transaction !== 'function') {
    throw evidenceError(ACCOUNTING_EVIDENCE_ERRORS.unavailable, 'Canonical PostgreSQL accounting evidence repository is not connected.', 503)
  }

  return {
    connected: true,

    async commitExternalFunding(input = {}) {
      const scope = normalizedScope(input)
      const request = input.request ?? {}
      assertRequestBoundary(request)
      const authority = authenticatedHumanAuthority(input.authority, scope)
      const idempotencyKey = requireIdempotencyKey(request.idempotencyKey)
      const amount = money(request.amount)
      const kind = String(request.kind ?? '').toUpperCase()
      if ((kind === 'DEPOSIT' && amount <= 0) || (kind === 'WITHDRAWAL' && amount >= 0) || !['DEPOSIT', 'WITHDRAWAL'].includes(kind)) {
        throw evidenceError(ACCOUNTING_EVIDENCE_ERRORS.invalidRequest, 'Deposits must be positive and withdrawals must be negative.', 400, 'external funding direction is invalid')
      }
      const eventKind = `EXTERNAL_${kind}`
      return database.transaction(async (client) => {
        const before = await loadAccountForUpdate(client, scope)
        const prior = await loadOperation(client, before.id, idempotencyKey)
        if (assertOperationRetry(prior, [{ eventKind, amount }])) {
          return { ok: true, duplicate: true, account: accountFromRow(before), evidence: prior[0] }
        }
        const beforeState = accountFromRow(before)
        const after = await mutateAccount(client, before, amount)
        const evidence = await insertEvidence(client, {
          account: after, scope, eventKind, amount, cashBefore: beforeState.cash, cashAfter: Number(after.cash),
          revisionBefore: beforeState.revision, revisionAfter: Number(after.revision), idempotencyKey,
          actorUserId: authority.userId, actorRole: authority.role, authoritySource: authority.source,
        })
        return { ok: true, duplicate: false, account: accountFromRow(after), evidence }
      })
    },

    async correctExternalFunding(input = {}) {
      const scope = normalizedScope(input)
      const request = input.request ?? {}
      assertRequestBoundary(request)
      const authority = authenticatedHumanAuthority(input.authority, scope)
      const idempotencyKey = requireIdempotencyKey(request.idempotencyKey)
      const originalEvidenceId = String(request.originalEvidenceId ?? '').trim()
      const replacementAmount = money(request.replacementAmount, 'replacementAmount')
      if (!originalEvidenceId) throw evidenceError(ACCOUNTING_EVIDENCE_ERRORS.invalidRequest, 'Correction requires the original evidence id.', 400, 'external funding correction target is invalid')

      return database.transaction(async (client) => {
        let account = await loadAccountForUpdate(client, scope)
        const originalResult = await client.query(
          `SELECT * FROM atlas_paper_accounting_evidence
           WHERE id=$1 AND account_record_id=$2 AND organization_id=$3 AND team_workspace_id=$4 AND account_id=$5 AND user_id=$6
           FOR UPDATE`,
          [originalEvidenceId, account.id, scope.organizationId, scope.teamWorkspaceId, scope.accountId, scope.userId],
        )
        const original = originalResult.rows?.[0] ? evidenceFromRow(originalResult.rows[0]) : null
        if (!original || !['OPENING_FUNDING', 'EXTERNAL_DEPOSIT', 'EXTERNAL_WITHDRAWAL', 'EXTERNAL_REPLACEMENT'].includes(original.eventKind)) {
          throw evidenceError(ACCOUNTING_EVIDENCE_ERRORS.invalidRequest, 'Corrections may only target durable external funding evidence.', 400, 'external funding correction target is invalid')
        }
        if ((original.amount > 0 && replacementAmount <= 0) || (original.amount < 0 && replacementAmount >= 0) || replacementAmount === original.amount) {
          throw evidenceError(ACCOUNTING_EVIDENCE_ERRORS.invalidRequest, 'Replacement funding must preserve direction and change the original amount.', 400, 'external funding replacement amount is invalid')
        }
        const expected = [
          { eventKind: 'EXTERNAL_REVERSAL', amount: rounded(-original.amount), linkedEvidenceId: original.evidenceId },
          { eventKind: 'EXTERNAL_REPLACEMENT', amount: replacementAmount, linkedEvidenceId: original.evidenceId },
        ]
        const prior = await loadOperation(client, account.id, idempotencyKey)
        if (assertOperationRetry(prior, expected)) {
          return { ok: true, duplicate: true, account: accountFromRow(account), reversal: prior[0], replacement: prior[1] }
        }
        const priorCorrection = await client.query(
          `SELECT id FROM atlas_paper_accounting_evidence
           WHERE account_record_id=$1 AND linked_evidence_id=$2 AND event_kind='EXTERNAL_REVERSAL'`,
          [account.id, original.evidenceId],
        )
        if (priorCorrection.rows?.[0]) throw evidenceError(ACCOUNTING_EVIDENCE_ERRORS.conflict, 'External funding evidence was already corrected.', 409, 'external funding evidence was already corrected')

        const beforeReversal = accountFromRow(account)
        const reversedAccount = await mutateAccount(client, account, expected[0].amount)
        const reversal = await insertEvidence(client, {
          account: reversedAccount, scope, ...expected[0], cashBefore: beforeReversal.cash, cashAfter: Number(reversedAccount.cash),
          revisionBefore: beforeReversal.revision, revisionAfter: Number(reversedAccount.revision), idempotencyKey, operationIndex: 0,
          actorUserId: authority.userId, actorRole: authority.role, authoritySource: authority.source,
        })
        account = reversedAccount
        const beforeReplacement = accountFromRow(account)
        const replacedAccount = await mutateAccount(client, account, replacementAmount)
        const replacement = await insertEvidence(client, {
          account: replacedAccount, scope, ...expected[1], cashBefore: beforeReplacement.cash, cashAfter: Number(replacedAccount.cash),
          revisionBefore: beforeReplacement.revision, revisionAfter: Number(replacedAccount.revision), idempotencyKey, operationIndex: 1,
          actorUserId: authority.userId, actorRole: authority.role, authoritySource: authority.source,
        })
        return { ok: true, duplicate: false, account: accountFromRow(replacedAccount), reversal, replacement }
      })
    },

    async listExternalFunding(input = {}) {
      const scope = normalizedScope(input)
      const result = await database.query(
        `SELECT evidence.* FROM atlas_paper_accounting_evidence evidence
         JOIN atlas_paper_accounts account ON account.id=evidence.account_record_id
         WHERE account.organization_id=$1 AND account.team_workspace_id=$2 AND account.account_id=$3 AND account.user_id=$4
           AND evidence.event_kind IN ('OPENING_FUNDING','EXTERNAL_DEPOSIT','EXTERNAL_WITHDRAWAL','EXTERNAL_REVERSAL','EXTERNAL_REPLACEMENT')
         ORDER BY evidence.account_revision_after ASC`,
        [scope.organizationId, scope.teamWorkspaceId, scope.accountId, scope.userId],
      )
      return (result.rows ?? []).map(evidenceFromRow)
    },

    async reconcileAccount(input = {}) {
      const scope = normalizedScope(input)
      return database.transaction(async (client) => {
        let accountRow
        try {
          accountRow = await loadAccountForUpdate(client, scope)
        } catch (error) {
          if (error?.code === ACCOUNTING_EVIDENCE_ERRORS.accountMissing) {
            return reconciliationResult(ACCOUNTING_RECONCILIATION_STATUS.unavailable, null, [], ['ACCOUNT_NOT_FOUND'])
          }
          throw error
        }
        const account = accountFromRow(accountRow)
        const evidenceResult = await client.query(
          `SELECT * FROM atlas_paper_accounting_evidence
           WHERE account_record_id=$1 AND organization_id=$2 AND team_workspace_id=$3 AND account_id=$4 AND user_id=$5
           ORDER BY account_revision_after ASC,id ASC`,
          [account.recordId, scope.organizationId, scope.teamWorkspaceId, scope.accountId, scope.userId],
        )
        const evidence = (evidenceResult.rows ?? []).map(evidenceFromRow)
        if (!account.accountingOriginId) {
          return reconciliationResult(ACCOUNTING_RECONCILIATION_STATUS.unavailable, account, evidence, ['LEGACY_ORIGIN_EVIDENCE_UNAVAILABLE'])
        }
        const openings = evidence.filter((row) => row.eventKind === 'OPENING_FUNDING')
        if (openings.length !== 1) {
          return reconciliationResult(ACCOUNTING_RECONCILIATION_STATUS.incomplete, account, evidence, ['OPENING_FUNDING_EVIDENCE_COUNT_INVALID'])
        }

        const reasons = []
        const opening = openings[0]
        if (opening.accountingOriginId !== account.accountingOriginId || opening.accountRevisionBefore !== -1 || opening.accountRevisionAfter !== 0
          || opening.cashBefore !== 0 || rounded(opening.amount) !== rounded(opening.cashAfter)) {
          reasons.push('OPENING_FUNDING_EVIDENCE_INVALID')
        }
        let priorRevision = -1
        let reconstructedCash = 0
        for (const row of evidence) {
          if (row.accountingOriginId !== account.accountingOriginId || row.accountRevisionBefore !== priorRevision
            || row.accountRevisionAfter !== priorRevision + 1 || rounded(row.cashBefore) !== rounded(reconstructedCash)
            || rounded(row.cashAfter) !== rounded(row.cashBefore + row.amount)) {
            reasons.push('ACCOUNTING_REVISION_OR_CASH_LINKAGE_GAP')
            break
          }
          priorRevision = row.accountRevisionAfter
          reconstructedCash = rounded(row.cashAfter)
        }

        const executionsResult = await client.query(
          `SELECT id,cash_impact FROM atlas_paper_executions
           WHERE account_record_id=$1 AND organization_id=$2 AND team_workspace_id=$3 AND account_id=$4 AND user_id=$5
           ORDER BY created_at ASC,id ASC`,
          [account.recordId, scope.organizationId, scope.teamWorkspaceId, scope.accountId, scope.userId],
        )
        const executionRows = executionsResult.rows ?? []
        const executionEvidence = evidence.filter((row) => row.eventKind === 'EXECUTION')
        const evidenceByExecution = new Map(executionEvidence.map((row) => [row.executionId, row]))
        if (executionRows.length !== executionEvidence.length || executionRows.some((row) => {
          const linked = evidenceByExecution.get(row.id)
          return !linked || rounded(linked.amount) !== rounded(Number(row.cash_impact))
        })) reasons.push('EXECUTION_EVIDENCE_LINKAGE_INCOMPLETE')

        for (const row of evidence.filter((item) => item.eventKind === 'EXTERNAL_REVERSAL')) {
          const linked = evidence.find((item) => item.evidenceId === row.linkedEvidenceId)
          const replacement = evidence.find((item) => item.idempotencyKey === row.idempotencyKey && item.eventKind === 'EXTERNAL_REPLACEMENT' && item.linkedEvidenceId === row.linkedEvidenceId)
          if (!linked || !EXTERNAL_EVENT_KINDS.has(linked.eventKind) || rounded(row.amount) !== rounded(-linked.amount) || !replacement) {
            reasons.push('CORRECTION_LINKAGE_INCOMPLETE')
          }
        }
        for (const row of evidence.filter((item) => item.eventKind === 'EXTERNAL_REPLACEMENT')) {
          const reversal = evidence.find((item) => item.idempotencyKey === row.idempotencyKey && item.eventKind === 'EXTERNAL_REVERSAL' && item.linkedEvidenceId === row.linkedEvidenceId)
          if (!reversal) reasons.push('CORRECTION_LINKAGE_INCOMPLETE')
        }
        if (account.revision !== priorRevision || rounded(account.cash) !== rounded(reconstructedCash)) reasons.push('CURRENT_ACCOUNT_STATE_UNEXPLAINED')
        const uniqueReasons = [...new Set(reasons)]
        return reconciliationResult(uniqueReasons.length ? ACCOUNTING_RECONCILIATION_STATUS.incomplete : ACCOUNTING_RECONCILIATION_STATUS.complete, account, evidence, uniqueReasons)
      })
    },
  }
}
