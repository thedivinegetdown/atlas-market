import { randomUUID } from 'node:crypto'
import { AppError } from '../../errors/appError.js'
import { getAssetProfile, normalizeAssetType } from '../../assets/index.js'
import {
  EQUITY_OBSERVATION_STATUS,
  EQUITY_VALUATION_DENOMINATION,
  EQUITY_VALUATION_POLICY_VERSION,
} from './equityObservationRepository.js'

export const HIGH_WATER_ACCOUNTING_CONTRACT_VERSION = 'cash-flow-neutral-high-water-v1'

export const HIGH_WATER_STATUS = Object.freeze({
  available: 'AVAILABLE',
  unavailable: 'UNAVAILABLE',
})

export const HIGH_WATER_ERRORS = Object.freeze({
  unavailable: 'paper_high_water_unavailable',
  invalidScope: 'paper_high_water_tenant_scope_invalid',
  invalidRequest: 'paper_high_water_request_invalid',
  accountMissing: 'paper_high_water_account_missing',
  recoveryFailed: 'paper_high_water_recovery_failed',
  freshObservationRequired: 'paper_high_water_fresh_observation_required',
  persistence: 'paper_high_water_persistence_failed',
})

const EXTERNAL_EVENT_KINDS = new Set([
  'OPENING_FUNDING',
  'EXTERNAL_DEPOSIT',
  'EXTERNAL_WITHDRAWAL',
  'EXTERNAL_REVERSAL',
  'EXTERNAL_REPLACEMENT',
])
const ACCOUNTING_EVENT_KINDS = new Set([...EXTERNAL_EVENT_KINDS, 'EXECUTION'])
const SUPPORTED_POSITION_TYPES = new Set(['equity', 'etf', 'futures', 'options'])
const FORBIDDEN_REQUEST_FIELDS = new Set([
  'normalizedValue', 'normalized_value', 'highWater', 'high_water_value', 'drawdownAmount', 'drawdown_amount',
  'cumulativeFunding', 'cumulative_funding', 'fundingCutoff', 'accountingOriginId', 'checkpointOrder',
  'completenessStatus', 'availabilityStatus', 'recordedAt', 'predecessorCheckpointId',
])

function highWaterError(code, detail, statusCode = 409, publicMessage = 'paper high-water evidence is unavailable', metadata = {}) {
  return new AppError(code, detail, {
    statusCode,
    publicMessage,
    metadata: { paperTradingOnly: true, liveOrders: false, brokerExecution: false, ...metadata },
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
    throw highWaterError(HIGH_WATER_ERRORS.invalidScope, 'Organization, account, and user scope are required.', 403, 'paper high-water tenant scope is invalid')
  }
  return scope
}

function assertRequestBoundary(input = {}) {
  const supplied = Object.keys(input).filter((field) => FORBIDDEN_REQUEST_FIELDS.has(field))
  if (supplied.length) {
    throw highWaterError(
      HIGH_WATER_ERRORS.invalidRequest,
      `High-water requests cannot supply authoritative fields: ${supplied.join(', ')}.`,
      400,
      'paper high-water request contains authoritative fields',
    )
  }
}

function strictNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function money(value) {
  const number = strictNumber(value)
  const cents = number == null ? null : number * 100
  return cents != null && Number.isSafeInteger(Math.round(cents)) && Math.abs(cents - Math.round(cents)) <= 1e-7
    ? Math.round(cents) / 100
    : null
}

function integer(value) {
  const number = strictNumber(value)
  return Number.isSafeInteger(number) ? number : null
}

function timestamp(value) {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

function parseJson(value, fallback) {
  if (value == null) return fallback
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { return fallback }
}

function fail(reason, detail = reason) {
  throw highWaterError(HIGH_WATER_ERRORS.recoveryFailed, detail, 409, 'paper high-water recovery failed closed', { reason })
}

function sameMoney(left, right) {
  return money(left) != null && money(right) != null && money(left) === money(right)
}

function accountFromRow(row = {}) {
  return {
    recordId: String(row.id ?? ''),
    organizationId: String(row.organization_id ?? ''),
    teamWorkspaceId: String(row.team_workspace_id ?? ''),
    accountId: String(row.account_id ?? ''),
    userId: String(row.user_id ?? ''),
    accountingOriginId: row.accounting_origin_id ?? null,
    cash: money(row.cash),
    revision: integer(row.revision),
  }
}

function evidenceFromRow(row = {}) {
  return {
    evidenceId: String(row.id ?? ''),
    accountRecordId: String(row.account_record_id ?? ''),
    organizationId: String(row.organization_id ?? ''),
    teamWorkspaceId: String(row.team_workspace_id ?? ''),
    accountId: String(row.account_id ?? ''),
    userId: String(row.user_id ?? ''),
    accountingOriginId: row.accounting_origin_id ?? null,
    eventKind: String(row.event_kind ?? ''),
    amount: money(row.amount),
    cashBefore: money(row.cash_before),
    cashAfter: money(row.cash_after),
    revisionBefore: integer(row.account_revision_before),
    revisionAfter: integer(row.account_revision_after),
    linkedEvidenceId: row.linked_evidence_id ?? null,
    executionId: row.execution_id ?? null,
    idempotencyKey: String(row.operation_idempotency_key ?? ''),
  }
}

function observationFromRow(row = {}) {
  return {
    observationId: String(row.id ?? ''),
    accountRecordId: String(row.account_record_id ?? ''),
    organizationId: String(row.organization_id ?? ''),
    teamWorkspaceId: String(row.team_workspace_id ?? ''),
    accountId: String(row.account_id ?? ''),
    userId: String(row.user_id ?? ''),
    accountRevision: integer(row.account_revision),
    observationOrder: integer(row.observation_order),
    valuationTimestamp: timestamp(row.valuation_timestamp),
    recordedAt: timestamp(row.recorded_at),
    accountingOriginId: row.accounting_origin_id ?? null,
    accountingCutoff: row.accounting_cutoff_evidence_id ? {
      evidenceId: row.accounting_cutoff_evidence_id,
      revision: integer(row.accounting_cutoff_revision),
    } : null,
    fundingCutoff: row.funding_cutoff_evidence_id ? {
      evidenceId: row.funding_cutoff_evidence_id,
      revision: integer(row.funding_cutoff_revision),
    } : null,
    canonicalCash: money(row.canonical_cash),
    denomination: row.denomination,
    positionManifest: parseJson(row.position_manifest, null),
    signedMarkedValue: money(row.signed_marked_value),
    equity: money(row.equity),
    valuationPolicyVersion: row.valuation_policy_version,
    completenessStatus: row.completeness_status,
    reasons: parseJson(row.reasons, null),
  }
}

function checkpointFromRow(row = {}) {
  return {
    checkpointId: String(row.id ?? ''),
    accountRecordId: String(row.account_record_id ?? ''),
    organizationId: String(row.organization_id ?? ''),
    teamWorkspaceId: String(row.team_workspace_id ?? ''),
    accountId: String(row.account_id ?? ''),
    userId: String(row.user_id ?? ''),
    accountingOriginId: row.accounting_origin_id ?? null,
    accountingContractVersion: row.accounting_contract_version,
    checkpointOrder: integer(row.checkpoint_order),
    checkpointRevision: integer(row.checkpoint_revision),
    sourceObservationId: String(row.source_observation_id ?? ''),
    sourceObservationOrder: integer(row.source_observation_order),
    sourceObservationRevision: integer(row.source_observation_revision),
    fundingCutoff: row.funding_cutoff_evidence_id ? {
      evidenceId: row.funding_cutoff_evidence_id,
      revision: integer(row.funding_cutoff_revision),
    } : null,
    cumulativeFunding: money(row.cumulative_funding),
    normalizedValue: money(row.normalized_value),
    highWater: money(row.high_water_value),
    highWaterObservationId: String(row.high_water_observation_id ?? ''),
    highWaterObservationOrder: integer(row.high_water_observation_order),
    predecessorCheckpointId: row.predecessor_checkpoint_id ?? null,
    completenessStatus: row.completeness_status,
    availabilityStatus: row.availability_status,
    recordedAt: timestamp(row.recorded_at),
    drawdownAmount: money(money(row.high_water_value) - money(row.normalized_value)),
    paperTradingOnly: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

function assertScoped(record, account, scope, reason) {
  if (record.accountRecordId !== account.recordId || record.organizationId !== scope.organizationId
    || record.teamWorkspaceId !== scope.teamWorkspaceId || record.accountId !== scope.accountId
    || record.userId !== scope.userId) fail(reason)
}

function validateAccounting(account, scope, evidenceRows, executionRows) {
  if (!account.accountingOriginId) fail('MISSING_ACCOUNTING_ORIGIN')
  if (account.cash == null || account.revision == null || account.revision < 0) fail('INVALID_CURRENT_ACCOUNT_STATE')
  const evidence = evidenceRows.map(evidenceFromRow)
  if (!evidence.length) fail('MISSING_ACCOUNTING_ORIGIN')
  if (evidence.filter((row) => row.eventKind === 'OPENING_FUNDING').length !== 1) fail('OPENING_FUNDING_EVIDENCE_INVALID')
  const ids = new Set()
  let reconstructedCash = 0
  let priorRevision = -1
  for (const row of evidence) {
    assertScoped(row, account, scope, 'ACCOUNTING_SCOPE_MISMATCH')
    if (!row.evidenceId || ids.has(row.evidenceId)) fail('ACCOUNTING_EVIDENCE_ID_INVALID')
    ids.add(row.evidenceId)
    if (!ACCOUNTING_EVENT_KINDS.has(row.eventKind)
      || row.accountingOriginId !== account.accountingOriginId || row.amount == null || row.cashBefore == null || row.cashAfter == null
      || row.revisionBefore !== priorRevision || row.revisionAfter !== priorRevision + 1
      || !sameMoney(row.cashBefore, reconstructedCash) || !sameMoney(row.cashAfter, row.cashBefore + row.amount)) {
      fail('ACCOUNTING_REVISION_OR_CASH_LINKAGE_GAP')
    }
    if (row.revisionAfter === 0 && (row.eventKind !== 'OPENING_FUNDING' || row.revisionBefore !== -1
      || row.cashBefore !== 0 || row.amount <= 0)) fail('OPENING_FUNDING_EVIDENCE_INVALID')
    if ((row.eventKind === 'EXTERNAL_DEPOSIT' && row.amount <= 0)
      || (row.eventKind === 'EXTERNAL_WITHDRAWAL' && row.amount >= 0)
      || (row.eventKind === 'EXECUTION' && !row.executionId)
      || (row.eventKind !== 'EXECUTION' && row.executionId)) fail('ACCOUNTING_EVIDENCE_KIND_INVALID')
    priorRevision = row.revisionAfter
    reconstructedCash = row.cashAfter
  }
  if (evidence[0].eventKind !== 'OPENING_FUNDING') fail('MISSING_ACCOUNTING_ORIGIN')
  if (priorRevision !== account.revision || !sameMoney(reconstructedCash, account.cash)) fail('UNEXPLAINED_CASH_DIFFERENCE')

  const executionEvidence = evidence.filter((row) => row.eventKind === 'EXECUTION')
  if (new Set(executionEvidence.map((row) => row.executionId)).size !== executionEvidence.length) {
    fail('EXECUTION_CASH_RECONCILIATION_FAILED')
  }
  const byExecution = new Map(executionEvidence.map((row) => [row.executionId, row]))
  if (executionRows.length !== executionEvidence.length || executionRows.some((row) => {
    const linked = byExecution.get(row.id)
    return !linked || money(row.cash_impact) == null || !sameMoney(linked.amount, row.cash_impact)
  })) fail('EXECUTION_CASH_RECONCILIATION_FAILED')

  for (const row of evidence.filter((item) => item.eventKind === 'EXTERNAL_REVERSAL')) {
    const original = evidence.find((item) => item.evidenceId === row.linkedEvidenceId)
    const replacement = evidence.find((item) => item.eventKind === 'EXTERNAL_REPLACEMENT'
      && item.linkedEvidenceId === row.linkedEvidenceId && item.idempotencyKey === row.idempotencyKey)
    if (!original || !EXTERNAL_EVENT_KINDS.has(original.eventKind) || !sameMoney(row.amount, -original.amount) || !replacement) {
      fail('EXTERNAL_FUNDING_CORRECTION_INCONSISTENT')
    }
  }
  for (const row of evidence.filter((item) => item.eventKind === 'EXTERNAL_REPLACEMENT')) {
    const reversal = evidence.find((item) => item.eventKind === 'EXTERNAL_REVERSAL'
      && item.linkedEvidenceId === row.linkedEvidenceId && item.idempotencyKey === row.idempotencyKey)
    if (!reversal) fail('EXTERNAL_FUNDING_CORRECTION_INCONSISTENT')
  }
  return evidence
}

function fundingAtObservation(observation, evidence) {
  if (!observation.accountingCutoff || observation.accountingCutoff.revision !== observation.accountRevision) {
    fail('ACCOUNTING_CUTOFF_MISMATCH')
  }
  const accountingCutoff = evidence.find((row) => row.revisionAfter === observation.accountRevision)
  if (!accountingCutoff || accountingCutoff.evidenceId !== observation.accountingCutoff.evidenceId
    || !sameMoney(accountingCutoff.cashAfter, observation.canonicalCash)) fail('ACCOUNTING_CUTOFF_MISMATCH')
  const throughObservation = evidence.filter((row) => row.revisionAfter <= observation.accountRevision)
  const external = throughObservation.filter((row) => EXTERNAL_EVENT_KINDS.has(row.eventKind))
  const fundingCutoff = external.at(-1) ?? null
  if (!fundingCutoff || !observation.fundingCutoff || fundingCutoff.evidenceId !== observation.fundingCutoff.evidenceId
    || fundingCutoff.revisionAfter !== observation.fundingCutoff.revision) fail('FUNDING_CUTOFF_MISMATCH')
  return money(external.reduce((sum, row) => sum + row.amount, 0))
}

function validateCompleteManifest(observation) {
  const manifest = observation.positionManifest
  if (!manifest || manifest.status !== 'COMPLETE' || !Array.isArray(manifest.positions)
    || integer(manifest.count) !== manifest.positions.length) fail('CORRUPTED_OBSERVATION_REFERENCE')
  let signedMarkedValue = 0
  const positionIds = new Set()
  for (const position of manifest.positions) {
    const assetType = normalizeAssetType(position?.instrument?.assetType)
    const profile = getAssetProfile(assetType)
    const expectedMultiplier = strictNumber(profile?.contractMultiplier)
    const quantity = strictNumber(position?.quantity)
    const price = money(position?.mark?.price)
    const positionRevision = integer(position?.positionRevision)
    const positionId = String(position?.positionId ?? '')
    if (!positionId || positionIds.has(positionId) || !SUPPORTED_POSITION_TYPES.has(assetType)
      || position.instrument?.assetType !== assetType || position.instrument?.identity !== `${assetType}:${position.instrument?.symbol}`
      || !['long', 'short'].includes(position?.side) || quantity == null || quantity <= 0
      || positionRevision == null || positionRevision < 0 || expectedMultiplier == null
      || strictNumber(position?.multiplier) !== expectedMultiplier || position?.denomination !== EQUITY_VALUATION_DENOMINATION
      || price == null || price <= 0 || !timestamp(position?.mark?.timestamp) || !position?.mark?.provider
      || position.mark.provider === 'unknown' || position.mark.fallbackUsed || position.mark.mock
      || position.mark.dataStatus !== 'LIVE' || position.mark.sourceProvenance?.sourceCount < 1) {
      fail('UNSUPPORTED_DENOMINATION_OR_LIABILITY_MODEL')
    }
    positionIds.add(positionId)
    const marked = quantity * price * expectedMultiplier
    signedMarkedValue += position.side === 'short' ? -marked : marked
  }
  signedMarkedValue = money(signedMarkedValue)
  if (signedMarkedValue == null || !sameMoney(signedMarkedValue, observation.signedMarkedValue)
    || !sameMoney(observation.equity, observation.canonicalCash + signedMarkedValue)) fail('INVALID_NUMERIC_EVIDENCE')
}

function validateObservations(account, scope, rows, evidence) {
  const observations = rows.map(observationFromRow)
  const ids = new Set()
  for (let index = 0; index < observations.length; index += 1) {
    const observation = observations[index]
    assertScoped(observation, account, scope, 'OBSERVATION_SCOPE_MISMATCH')
    if (!observation.observationId || ids.has(observation.observationId)) fail('CORRUPTED_OBSERVATION_REFERENCE')
    ids.add(observation.observationId)
    if (observation.observationOrder !== index + 1) fail('OBSERVATION_ORDER_GAP')
    if (observation.accountRevision == null || observation.accountRevision < 0 || observation.accountRevision > account.revision
      || !observation.valuationTimestamp || !observation.recordedAt || observation.accountingOriginId !== account.accountingOriginId
      || observation.denomination !== EQUITY_VALUATION_DENOMINATION
      || observation.valuationPolicyVersion !== EQUITY_VALUATION_POLICY_VERSION) fail('CORRUPTED_OBSERVATION_REFERENCE')
    observation.cumulativeFunding = fundingAtObservation(observation, evidence)
    if (observation.completenessStatus === EQUITY_OBSERVATION_STATUS.complete) {
      if (!Array.isArray(observation.reasons) || observation.reasons.length || observation.canonicalCash == null
        || observation.equity == null || observation.signedMarkedValue == null) fail('CORRUPTED_OBSERVATION_REFERENCE')
      validateCompleteManifest(observation)
      observation.normalizedValue = money(observation.equity - observation.cumulativeFunding)
      if (observation.normalizedValue == null) fail('INVALID_NUMERIC_EVIDENCE')
    } else if (![EQUITY_OBSERVATION_STATUS.incomplete, EQUITY_OBSERVATION_STATUS.unavailable].includes(observation.completenessStatus)
      || observation.equity != null || observation.signedMarkedValue != null
      || !Array.isArray(observation.reasons) || !observation.reasons.length) {
      fail('CORRUPTED_OBSERVATION_REFERENCE')
    }
  }
  return observations
}

function expectedCheckpoint(observation, previous) {
  const advances = !previous || observation.normalizedValue > previous.highWater
  return {
    checkpointOrder: previous ? previous.checkpointOrder + 1 : 1,
    checkpointRevision: previous ? previous.checkpointRevision + 1 : 0,
    sourceObservationId: observation.observationId,
    sourceObservationOrder: observation.observationOrder,
    sourceObservationRevision: observation.accountRevision,
    fundingCutoff: observation.fundingCutoff,
    cumulativeFunding: observation.cumulativeFunding,
    normalizedValue: observation.normalizedValue,
    highWater: previous ? Math.max(previous.highWater, observation.normalizedValue) : observation.normalizedValue,
    highWaterObservationId: advances ? observation.observationId : previous.highWaterObservationId,
    highWaterObservationOrder: advances ? observation.observationOrder : previous.highWaterObservationOrder,
    predecessorCheckpointId: previous?.checkpointId ?? null,
    completenessStatus: EQUITY_OBSERVATION_STATUS.complete,
    availabilityStatus: HIGH_WATER_STATUS.available,
  }
}

function validateCheckpoints(account, scope, rows, observations) {
  const byObservation = new Map(observations.map((row) => [row.observationId, row]))
  const checkpoints = rows.map(checkpointFromRow)
  let previous = null
  for (const checkpoint of checkpoints) {
    assertScoped(checkpoint, account, scope, 'CHECKPOINT_SCOPE_MISMATCH')
    const observation = byObservation.get(checkpoint.sourceObservationId)
    if (!observation || observation.completenessStatus !== EQUITY_OBSERVATION_STATUS.complete) fail('CORRUPTED_OBSERVATION_REFERENCE')
    const expected = expectedCheckpoint(observation, previous)
    if (!checkpoint.checkpointId || checkpoint.accountingOriginId !== account.accountingOriginId
      || checkpoint.accountingContractVersion !== HIGH_WATER_ACCOUNTING_CONTRACT_VERSION
      || checkpoint.checkpointOrder !== expected.checkpointOrder || checkpoint.checkpointRevision !== expected.checkpointRevision
      || checkpoint.sourceObservationOrder !== expected.sourceObservationOrder
      || checkpoint.sourceObservationRevision !== expected.sourceObservationRevision
      || checkpoint.fundingCutoff?.evidenceId !== expected.fundingCutoff?.evidenceId
      || checkpoint.fundingCutoff?.revision !== expected.fundingCutoff?.revision
      || !sameMoney(checkpoint.cumulativeFunding, expected.cumulativeFunding)
      || !sameMoney(checkpoint.normalizedValue, expected.normalizedValue) || !sameMoney(checkpoint.highWater, expected.highWater)
      || checkpoint.highWaterObservationId !== expected.highWaterObservationId
      || checkpoint.highWaterObservationOrder !== expected.highWaterObservationOrder
      || checkpoint.predecessorCheckpointId !== expected.predecessorCheckpointId
      || checkpoint.completenessStatus !== expected.completenessStatus
      || checkpoint.availabilityStatus !== expected.availabilityStatus || !checkpoint.recordedAt) {
      fail('CHECKPOINT_PREDECESSOR_INCONSISTENCY')
    }
    previous = checkpoint
  }
  return checkpoints
}

function unavailableResult(reason, checkpoints = [], observations = []) {
  const latest = checkpoints.at(-1) ?? null
  return {
    status: HIGH_WATER_STATUS.unavailable,
    reasons: [reason],
    historicalHighWater: latest?.highWater ?? null,
    latestCheckpoint: latest,
    progression: checkpoints,
    latestObservationId: observations.at(-1)?.observationId ?? null,
    currentNormalizedValue: null,
    currentDrawdownAmount: null,
    currentValuationStatus: HIGH_WATER_STATUS.unavailable,
    paperTradingOnly: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

async function loadState(client, scope) {
  const accountResult = await client.query(
    `SELECT * FROM atlas_paper_accounts
     WHERE organization_id=$1 AND team_workspace_id=$2 AND account_id=$3 AND user_id=$4
     FOR UPDATE`,
    [scope.organizationId, scope.teamWorkspaceId, scope.accountId, scope.userId],
  )
  if (!accountResult.rows?.[0]) throw highWaterError(HIGH_WATER_ERRORS.accountMissing, 'Canonical PAPER account does not exist.', 404, 'paper account does not exist')
  const account = accountFromRow(accountResult.rows[0])
  const params = [account.recordId, scope.organizationId, scope.teamWorkspaceId, scope.accountId, scope.userId]
  const evidenceResult = await client.query(
    `SELECT * FROM atlas_paper_accounting_evidence
     WHERE account_record_id=$1 AND organization_id=$2 AND team_workspace_id=$3 AND account_id=$4 AND user_id=$5
     ORDER BY account_revision_after ASC,id ASC`, params,
  )
  const executionResult = await client.query(
    `SELECT id,cash_impact FROM atlas_paper_executions
     WHERE account_record_id=$1 AND organization_id=$2 AND team_workspace_id=$3 AND account_id=$4 AND user_id=$5
     ORDER BY created_at ASC,id ASC`, params,
  )
  const observationResult = await client.query(
    `SELECT * FROM atlas_paper_equity_observations
     WHERE account_record_id=$1 AND organization_id=$2 AND team_workspace_id=$3 AND account_id=$4 AND user_id=$5
     ORDER BY observation_order ASC`, params,
  )
  const checkpointResult = await client.query(
    `SELECT * FROM atlas_paper_high_water_checkpoints
     WHERE account_record_id=$1 AND organization_id=$2 AND team_workspace_id=$3 AND account_id=$4 AND user_id=$5
     ORDER BY checkpoint_order ASC`, params,
  )
  return {
    account,
    evidence: validateAccounting(account, scope, evidenceResult.rows ?? [], executionResult.rows ?? []),
    observationRows: observationResult.rows ?? [],
    checkpointRows: checkpointResult.rows ?? [],
  }
}

async function insertCheckpoint(client, account, scope, observation, previous) {
  const expected = expectedCheckpoint(observation, previous)
  const result = await client.query(
    `INSERT INTO atlas_paper_high_water_checkpoints
      (id,account_record_id,organization_id,team_workspace_id,account_id,user_id,accounting_origin_id,
       accounting_contract_version,checkpoint_order,checkpoint_revision,source_observation_id,
       source_observation_order,source_observation_revision,funding_cutoff_evidence_id,funding_cutoff_revision,
       cumulative_funding,normalized_value,high_water_value,high_water_observation_id,high_water_observation_order,
       predecessor_checkpoint_id,completeness_status,availability_status,recorded_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,clock_timestamp())
     RETURNING *`,
    [`paper-high-water-${randomUUID()}`, account.recordId, scope.organizationId, scope.teamWorkspaceId,
      scope.accountId, scope.userId, account.accountingOriginId, HIGH_WATER_ACCOUNTING_CONTRACT_VERSION,
      expected.checkpointOrder, expected.checkpointRevision, expected.sourceObservationId,
      expected.sourceObservationOrder, expected.sourceObservationRevision, expected.fundingCutoff.evidenceId,
      expected.fundingCutoff.revision, expected.cumulativeFunding, expected.normalizedValue, expected.highWater,
      expected.highWaterObservationId, expected.highWaterObservationOrder, expected.predecessorCheckpointId,
      expected.completenessStatus, expected.availabilityStatus],
  )
  if (!result.rows?.[0]) throw highWaterError(HIGH_WATER_ERRORS.persistence, 'High-water checkpoint was not durably persisted.')
  return checkpointFromRow(result.rows[0])
}

async function reconstruct(client, scope, { sourceObservationId = null } = {}) {
  const state = await loadState(client, scope)
  const observations = validateObservations(state.account, scope, state.observationRows, state.evidence)
  let checkpoints = validateCheckpoints(state.account, scope, state.checkpointRows, observations)
  const requested = sourceObservationId ? observations.find((row) => row.observationId === sourceObservationId) : null
  if (sourceObservationId && !requested) fail('CORRUPTED_OR_MISSING_OBSERVATION_REFERENCE')
  if (!observations.length) return { ...unavailableResult('EQUITY_OBSERVATION_HISTORY_UNAVAILABLE'), replayedCount: 0, requestedWasDuplicate: false }

  if (!checkpoints.length && observations[0].completenessStatus !== EQUITY_OBSERVATION_STATUS.complete) {
    return { ...unavailableResult('LEGACY_INCOMPLETE_HISTORY', checkpoints, observations), replayedCount: 0, requestedWasDuplicate: false }
  }
  const existingSourceIds = new Set(checkpoints.map((row) => row.sourceObservationId))
  const requestedWasDuplicate = sourceObservationId ? existingSourceIds.has(sourceObservationId) : false
  const latestSourceOrder = checkpoints.at(-1)?.sourceObservationOrder ?? 0
  let replayedCount = 0
  for (const observation of observations.filter((row) => row.observationOrder > latestSourceOrder)) {
    if (observation.completenessStatus !== EQUITY_OBSERVATION_STATUS.complete) continue
    const inserted = await insertCheckpoint(client, state.account, scope, observation, checkpoints.at(-1) ?? null)
    checkpoints = [...checkpoints, inserted]
    replayedCount += 1
  }
  if (requested && requested.completenessStatus !== EQUITY_OBSERVATION_STATUS.complete) {
    return { ...unavailableResult('SOURCE_OBSERVATION_INCOMPLETE', checkpoints, observations), replayedCount, requestedWasDuplicate }
  }
  const latestObservation = observations.at(-1)
  const latestCheckpoint = checkpoints.at(-1) ?? null
  if (!latestCheckpoint) return { ...unavailableResult('LEGACY_INCOMPLETE_HISTORY', checkpoints, observations), replayedCount, requestedWasDuplicate }
  const latestIsComplete = latestObservation.completenessStatus === EQUITY_OBSERVATION_STATUS.complete
  const currentAccountWasObserved = latestObservation.accountRevision === state.account.revision
  const evidenceAvailable = latestIsComplete && currentAccountWasObserved
  return {
    status: evidenceAvailable ? HIGH_WATER_STATUS.available : HIGH_WATER_STATUS.unavailable,
    reasons: evidenceAvailable ? [] : [latestIsComplete ? 'CURRENT_OBSERVATION_MISSING' : 'LATEST_OBSERVATION_INCOMPLETE'],
    historicalHighWater: latestCheckpoint.highWater,
    latestCheckpoint,
    progression: checkpoints,
    latestObservationId: latestObservation.observationId,
    latestNormalizedValue: latestCheckpoint.normalizedValue,
    latestDrawdownAmount: latestCheckpoint.drawdownAmount,
    currentNormalizedValue: null,
    currentDrawdownAmount: null,
    currentValuationStatus: HIGH_WATER_STATUS.unavailable,
    currentValuationReason: 'NEW_EQUITY_OBSERVATION_REQUIRED',
    replayedCount,
    requestedWasDuplicate,
    paperTradingOnly: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

export function createPaperHighWaterRepository({ database } = {}) {
  if (!database?.connected || typeof database.query !== 'function' || typeof database.transaction !== 'function') {
    throw highWaterError(HIGH_WATER_ERRORS.unavailable, 'Canonical PostgreSQL high-water repository is not connected.', 503)
  }
  return {
    connected: true,
    persistenceMode: 'postgresql',

    async advance(input = {}) {
      assertRequestBoundary(input)
      const scope = normalizedScope(input)
      const sourceObservationId = String(input.sourceObservationId ?? '').trim()
      if (!sourceObservationId) throw highWaterError(HIGH_WATER_ERRORS.invalidRequest, 'A source observation id is required.', 400, 'source observation id is required')
      return database.transaction(async (client) => {
        const result = await reconstruct(client, scope, { sourceObservationId })
        return { ...result, duplicate: result.requestedWasDuplicate }
      })
    },

    async recover(input = {}) {
      assertRequestBoundary(input)
      const scope = normalizedScope(input)
      if (input.currentValuationRequested === true) {
        throw highWaterError(
          HIGH_WATER_ERRORS.freshObservationRequired,
          'Recovery cannot relabel a historical mark as current; create a new valid server-owned Slice 2B observation.',
          409,
          'a new server-owned equity observation is required for current valuation',
        )
      }
      return database.transaction((client) => reconstruct(client, scope))
    },
  }
}
