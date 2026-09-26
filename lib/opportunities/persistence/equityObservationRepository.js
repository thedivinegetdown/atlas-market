import { randomUUID } from 'node:crypto'
import { AppError } from '../../errors/appError.js'
import { getAssetProfile, normalizeAssetType } from '../../assets/index.js'
import { normalizeMarketDataProvenance } from '../../market/marketDataProvenanceContract.js'
import { DEFAULT_PAPER_EXIT_CONFIG } from '../paperExit/paperExitConfig.js'
import { calculateCanonicalSignedMarkedValue } from './canonicalPaperLedgerRepository.js'

export const EQUITY_OBSERVATION_STATUS = Object.freeze({
  complete: 'COMPLETE',
  incomplete: 'INCOMPLETE',
  unavailable: 'UNAVAILABLE',
})

export const EQUITY_OBSERVATION_ERRORS = Object.freeze({
  unavailable: 'paper_equity_observation_unavailable',
  invalidScope: 'paper_equity_observation_tenant_scope_invalid',
  invalidRequest: 'paper_equity_observation_request_invalid',
  accountMissing: 'paper_equity_observation_account_missing',
  persistence: 'paper_equity_observation_persistence_failed',
})

export const EQUITY_VALUATION_POLICY_VERSION = 'canonical-paper-equity-observation-v1'
export const EQUITY_VALUATION_DENOMINATION = 'USD'

const SUPPORTED_POSITION_TYPES = new Set(['equity', 'etf', 'futures', 'options'])
const EXTERNAL_EVENT_KINDS = new Set([
  'OPENING_FUNDING',
  'EXTERNAL_DEPOSIT',
  'EXTERNAL_WITHDRAWAL',
  'EXTERNAL_REVERSAL',
  'EXTERNAL_REPLACEMENT',
])
const AUTHORITATIVE_FIELDS = new Set([
  'cash', 'canonicalCash', 'equity', 'marks', 'positions', 'positionManifest', 'valuationTimestamp',
  'recordedAt', 'accountRevision', 'accountingOriginId', 'accountingCutoff', 'fundingCutoff',
  'provider', 'provenance', 'completenessStatus', 'reasons', 'valuationPolicyVersion', 'denomination',
  'canonical_cash', 'valuation_timestamp', 'recorded_at', 'account_revision', 'accounting_origin_id',
])

function observationError(code, detail, statusCode = 503, publicMessage = 'paper equity observation is unavailable') {
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
    throw observationError(EQUITY_OBSERVATION_ERRORS.invalidScope, 'Organization, account, and user scope are required.', 403, 'paper equity observation tenant scope is invalid')
  }
  return scope
}

function assertRequestBoundary(input = {}) {
  const request = input.request ?? {}
  const forbidden = [...new Set([
    ...Object.keys(input).filter((field) => AUTHORITATIVE_FIELDS.has(field)),
    ...Object.keys(request).filter((field) => field !== 'idempotencyKey'),
  ])]
  if (forbidden.length) {
    throw observationError(
      EQUITY_OBSERVATION_ERRORS.invalidRequest,
      `Equity observation requests cannot supply authoritative fields: ${forbidden.join(', ')}.`,
      400,
      'paper equity observation request contains authoritative fields',
    )
  }
  const idempotencyKey = String(request.idempotencyKey ?? '').trim()
  if (idempotencyKey.length < 8 || idempotencyKey.length > 200) {
    throw observationError(EQUITY_OBSERVATION_ERRORS.invalidRequest, 'An idempotency key between 8 and 200 characters is required.', 400, 'paper equity observation idempotency key is invalid')
  }
  return idempotencyKey
}

function strictNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function validMoney(value) {
  const number = strictNumber(value)
  return number != null && Number.isSafeInteger(Math.round(number * 100))
}

function rounded(value) {
  return Math.round(Number(value) * 100) / 100
}

function timestamp(value) {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

function unique(values) {
  return [...new Set(values)]
}

function accountFromRow(row = {}) {
  return {
    recordId: row.id,
    organizationId: row.organization_id,
    teamWorkspaceId: row.team_workspace_id,
    accountId: row.account_id,
    userId: row.user_id,
    accountingOriginId: row.accounting_origin_id ?? null,
    cash: strictNumber(row.cash),
    revision: strictNumber(row.revision),
  }
}

function evidenceFromRow(row = {}) {
  return {
    evidenceId: row.id,
    accountingOriginId: row.accounting_origin_id ?? null,
    eventKind: row.event_kind,
    amount: strictNumber(row.amount),
    cashBefore: strictNumber(row.cash_before),
    cashAfter: strictNumber(row.cash_after),
    accountRevisionBefore: strictNumber(row.account_revision_before),
    accountRevisionAfter: strictNumber(row.account_revision_after),
    linkedEvidenceId: row.linked_evidence_id ?? null,
    executionId: row.execution_id ?? null,
    idempotencyKey: row.operation_idempotency_key,
    createdAt: row.created_at,
  }
}

function accountingCutoff(account, evidenceRows, executionRows) {
  const evidence = evidenceRows.map(evidenceFromRow)
  const reasons = []
  if (!account.accountingOriginId) reasons.push('ACCOUNTING_ORIGIN_UNAVAILABLE')
  const openings = evidence.filter((row) => row.eventKind === 'OPENING_FUNDING')
  if (openings.length !== 1) reasons.push('OPENING_FUNDING_EVIDENCE_COUNT_INVALID')
  const opening = openings[0]
  if (opening && (opening.accountingOriginId !== account.accountingOriginId || opening.accountRevisionBefore !== -1
    || opening.accountRevisionAfter !== 0 || opening.cashBefore !== 0 || !validMoney(opening.amount)
    || !validMoney(opening.cashAfter) || rounded(opening.amount) !== rounded(opening.cashAfter))) {
    reasons.push('OPENING_FUNDING_EVIDENCE_INVALID')
  }

  let priorRevision = -1
  let reconstructedCash = 0
  for (const row of evidence) {
    if (!validMoney(row.amount) || !validMoney(row.cashBefore) || !validMoney(row.cashAfter)
      || row.accountingOriginId !== account.accountingOriginId || row.accountRevisionBefore !== priorRevision
      || row.accountRevisionAfter !== priorRevision + 1 || rounded(row.cashBefore) !== rounded(reconstructedCash)
      || rounded(row.cashAfter) !== rounded(row.cashBefore + row.amount)) {
      reasons.push('ACCOUNTING_REVISION_OR_CASH_LINKAGE_GAP')
      break
    }
    priorRevision = row.accountRevisionAfter
    reconstructedCash = rounded(row.cashAfter)
  }

  const executionEvidence = evidence.filter((row) => row.eventKind === 'EXECUTION')
  const evidenceByExecution = new Map(executionEvidence.map((row) => [row.executionId, row]))
  if (executionRows.length !== executionEvidence.length || executionRows.some((row) => {
    const linked = evidenceByExecution.get(row.id)
    return !linked || !validMoney(row.cash_impact) || rounded(linked.amount) !== rounded(Number(row.cash_impact))
  })) reasons.push('EXECUTION_EVIDENCE_LINKAGE_INCOMPLETE')

  for (const row of evidence.filter((item) => item.eventKind === 'EXTERNAL_REVERSAL')) {
    const linked = evidence.find((item) => item.evidenceId === row.linkedEvidenceId)
    const replacement = evidence.find((item) => item.idempotencyKey === row.idempotencyKey && item.eventKind === 'EXTERNAL_REPLACEMENT' && item.linkedEvidenceId === row.linkedEvidenceId)
    if (!linked || !EXTERNAL_EVENT_KINDS.has(linked.eventKind) || rounded(row.amount) !== rounded(-linked.amount) || !replacement) reasons.push('CORRECTION_LINKAGE_INCOMPLETE')
  }
  for (const row of evidence.filter((item) => item.eventKind === 'EXTERNAL_REPLACEMENT')) {
    const reversal = evidence.find((item) => item.idempotencyKey === row.idempotencyKey && item.eventKind === 'EXTERNAL_REVERSAL' && item.linkedEvidenceId === row.linkedEvidenceId)
    if (!reversal) reasons.push('CORRECTION_LINKAGE_INCOMPLETE')
  }
  if (!Number.isSafeInteger(account.revision) || account.revision < 0 || account.revision !== priorRevision
    || !validMoney(account.cash) || rounded(account.cash) !== rounded(reconstructedCash)) reasons.push('CURRENT_ACCOUNT_STATE_UNEXPLAINED')

  const accounting = evidence.at(-1) ?? null
  const funding = evidence.filter((row) => EXTERNAL_EVENT_KINDS.has(row.eventKind)).at(-1) ?? null
  return {
    status: reasons.length ? (reasons.includes('ACCOUNTING_ORIGIN_UNAVAILABLE') ? 'UNAVAILABLE' : 'INCOMPLETE') : 'COMPLETE',
    reasons: unique(reasons),
    accountingCutoff: accounting ? { evidenceId: accounting.evidenceId, revision: accounting.accountRevisionAfter } : null,
    fundingCutoff: funding ? { evidenceId: funding.evidenceId, revision: funding.accountRevisionAfter } : null,
  }
}

function rawPosition(row = {}) {
  return {
    positionId: String(row.id ?? '').trim(),
    accountRecordId: String(row.account_record_id ?? '').trim(),
    organizationId: String(row.organization_id ?? '').trim(),
    teamWorkspaceId: String(row.team_workspace_id ?? '').trim(),
    accountId: String(row.account_id ?? '').trim(),
    userId: String(row.user_id ?? '').trim(),
    symbol: String(row.symbol ?? '').trim().toUpperCase(),
    assetType: String(row.asset_type ?? '').trim().toLowerCase(),
    side: String(row.side ?? '').trim().toLowerCase(),
    quantity: strictNumber(row.quantity),
    revision: strictNumber(row.revision),
  }
}

function positionIdentity(position, scope, accountRecordId) {
  const reasons = []
  const normalizedAssetType = normalizeAssetType(position.assetType)
  const profile = getAssetProfile(normalizedAssetType)
  const multiplier = strictNumber(profile?.contractMultiplier)
  if (!position.positionId || !position.symbol || position.accountRecordId !== accountRecordId
    || position.organizationId !== scope.organizationId || position.teamWorkspaceId !== scope.teamWorkspaceId
    || position.accountId !== scope.accountId || position.userId !== scope.userId) reasons.push(`INCOMPLETE_POSITION_EVIDENCE:${position.positionId || position.symbol || 'UNKNOWN'}`)
  if (!SUPPORTED_POSITION_TYPES.has(position.assetType) || normalizedAssetType !== position.assetType) reasons.push(`UNSUPPORTED_DENOMINATION_OR_LIABILITY_MODEL:${position.positionId || position.symbol || 'UNKNOWN'}`)
  if (!['long', 'short'].includes(position.side) || position.quantity == null || position.quantity <= 0
    || !Number.isSafeInteger(position.revision) || position.revision < 0) reasons.push(`INVALID_POSITION_NUMERIC_OR_SIDE:${position.positionId || position.symbol || 'UNKNOWN'}`)
  if (multiplier == null || multiplier <= 0) reasons.push(`UNRESOLVED_INSTRUMENT_OR_MULTIPLIER:${position.positionId || position.symbol || 'UNKNOWN'}`)
  return {
    reasons,
    manifest: {
      positionId: position.positionId || null,
      positionRevision: Number.isSafeInteger(position.revision) ? position.revision : null,
      instrument: position.symbol && SUPPORTED_POSITION_TYPES.has(position.assetType)
        ? { symbol: position.symbol, assetType: position.assetType, identity: `${position.assetType}:${position.symbol}` }
        : null,
      side: ['long', 'short'].includes(position.side) ? position.side : null,
      quantity: position.quantity,
      multiplier,
      denomination: EQUITY_VALUATION_DENOMINATION,
      mark: null,
    },
  }
}

function positionSignature(rows = []) {
  return JSON.stringify(rows.map(rawPosition).map((position) => ({
    positionId: position.positionId,
    revision: position.revision,
    symbol: position.symbol,
    assetType: position.assetType,
    side: position.side,
    quantity: position.quantity,
  })))
}

function parseJson(value, fallback) {
  if (value == null) return fallback
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { return fallback }
}

function observationFromRow(row = {}) {
  return {
    observationId: row.id,
    observationOrder: Number(row.observation_order),
    organizationId: row.organization_id,
    teamWorkspaceId: row.team_workspace_id,
    accountId: row.account_id,
    userId: row.user_id,
    accountRevision: Number(row.account_revision),
    valuationTimestamp: timestamp(row.valuation_timestamp),
    recordedAt: timestamp(row.recorded_at),
    accountingOriginId: row.accounting_origin_id ?? null,
    accountingCutoff: row.accounting_cutoff_evidence_id ? { evidenceId: row.accounting_cutoff_evidence_id, revision: Number(row.accounting_cutoff_revision) } : null,
    fundingCutoff: row.funding_cutoff_evidence_id ? { evidenceId: row.funding_cutoff_evidence_id, revision: Number(row.funding_cutoff_revision) } : null,
    canonicalCash: row.canonical_cash == null ? null : Number(row.canonical_cash),
    denomination: row.denomination,
    positionManifest: parseJson(row.position_manifest, { status: 'INCOMPLETE', count: 0, positions: [] }),
    signedMarkedValue: row.signed_marked_value == null ? null : Number(row.signed_marked_value),
    equity: row.equity == null ? null : Number(row.equity),
    valuationPolicyVersion: row.valuation_policy_version,
    completenessStatus: row.completeness_status,
    reasons: parseJson(row.reasons, []),
    idempotencyKey: row.operation_idempotency_key,
    paperTradingOnly: true,
    liveOrders: false,
    brokerExecution: false,
  }
}

async function loadAccount(client, scope, lock = false) {
  const result = await client.query(
    `SELECT * FROM atlas_paper_accounts
     WHERE organization_id=$1 AND team_workspace_id=$2 AND account_id=$3 AND user_id=$4
     ${lock ? 'FOR UPDATE' : ''}`,
    [scope.organizationId, scope.teamWorkspaceId, scope.accountId, scope.userId],
  )
  return result.rows?.[0] ?? null
}

async function loadPositions(client, account, lock = false) {
  const result = await client.query(
    `SELECT * FROM atlas_paper_positions
     WHERE account_record_id=$1 AND status='open'
     ORDER BY symbol,asset_type,side,id
     ${lock ? 'FOR UPDATE' : ''}`,
    [account.id],
  )
  return result.rows ?? []
}

export function createEquityObservationRepository({ database, marketDataService, clock = () => new Date() } = {}) {
  if (!database?.connected || typeof database.query !== 'function' || typeof database.transaction !== 'function'
    || typeof marketDataService?.getQuote !== 'function') {
    throw observationError(EQUITY_OBSERVATION_ERRORS.unavailable, 'Canonical PostgreSQL and server-owned market data are required.')
  }

  return {
    connected: true,
    persistenceMode: 'postgresql',

    async observe(input = {}) {
      const scope = normalizedScope(input)
      const idempotencyKey = assertRequestBoundary(input)
      return database.transaction(async (client) => {
        const accountRow = await loadAccount(client, scope, true)
        if (!accountRow) throw observationError(EQUITY_OBSERVATION_ERRORS.accountMissing, 'Canonical PAPER account does not exist.', 404, 'paper account does not exist')
        const account = accountFromRow(accountRow)
        const duplicateResult = await client.query(
          `SELECT * FROM atlas_paper_equity_observations
           WHERE account_record_id=$1 AND operation_idempotency_key=$2`,
          [account.recordId, idempotencyKey],
        )
        if (duplicateResult.rows?.[0]) return { ok: true, duplicate: true, observation: observationFromRow(duplicateResult.rows[0]) }

        const initialPositionRows = await loadPositions(client, accountRow, true)
        const initialSignature = positionSignature(initialPositionRows)
        const evidenceResult = await client.query(
          `SELECT * FROM atlas_paper_accounting_evidence
           WHERE account_record_id=$1 AND organization_id=$2 AND team_workspace_id=$3 AND account_id=$4 AND user_id=$5
           ORDER BY account_revision_after ASC,id ASC`,
          [account.recordId, scope.organizationId, scope.teamWorkspaceId, scope.accountId, scope.userId],
        )
        const executionsResult = await client.query(
          `SELECT id,cash_impact FROM atlas_paper_executions
           WHERE account_record_id=$1 AND organization_id=$2 AND team_workspace_id=$3 AND account_id=$4 AND user_id=$5
           ORDER BY created_at ASC,id ASC`,
          [account.recordId, scope.organizationId, scope.teamWorkspaceId, scope.accountId, scope.userId],
        )
        const cutoff = accountingCutoff(account, evidenceResult.rows ?? [], executionsResult.rows ?? [])
        const reasons = [...cutoff.reasons]
        const positions = initialPositionRows.map(rawPosition)
        const identityResults = positions.map((position) => positionIdentity(position, scope, account.recordId))
        reasons.push(...identityResults.flatMap((result) => result.reasons))
        if (new Set(positions.map((position) => position.positionId)).size !== positions.length) reasons.push('INCOMPLETE_POSITION_EVIDENCE:DUPLICATE_POSITION_ID')

        const quotes = await Promise.all(identityResults.map(async (identity, index) => {
          if (identity.reasons.length) return null
          try {
            return await marketDataService.getQuote(positions[index].symbol, { assetType: positions[index].assetType })
          } catch {
            return null
          }
        }))
        const valuationTimestamp = timestamp(clock())
        if (!valuationTimestamp) reasons.push('INVALID_VALUATION_TIMESTAMP')

        const manifestPositions = identityResults.map((identity, index) => {
          const quote = quotes[index]
          const label = positions[index].positionId || positions[index].symbol || 'UNKNOWN'
          if (identity.reasons.length) return identity.manifest
          if (!quote) {
            reasons.push(`MISSING_MARK:${label}`)
            return identity.manifest
          }
          const provenance = normalizeMarketDataProvenance({
            ...(quote.provenance ?? {}),
            provider: quote.provenance?.provider ?? quote.provider,
            observedAt: quote.provenance?.observedAt ?? quote.updatedAt,
          }, { now: valuationTimestamp, staleAfterMs: DEFAULT_PAPER_EXIT_CONFIG.maxPriceAgeMs })
          const price = strictNumber(quote.price)
          const markTimestamp = timestamp(provenance.observedAt ?? quote.updatedAt)
          const age = valuationTimestamp && markTimestamp ? Date.parse(valuationTimestamp) - Date.parse(markTimestamp) : NaN
          if (price == null || price <= 0 || !validMoney(price)) reasons.push(`INVALID_MARK_NUMERIC:${label}`)
          if (!markTimestamp) reasons.push(`MISSING_MARK_TIMESTAMP:${label}`)
          else if (age < 0) reasons.push(`FUTURE_DATED_MARK:${label}`)
          else if (!Number.isFinite(age) || age > DEFAULT_PAPER_EXIT_CONFIG.maxPriceAgeMs || provenance.dataStatus === 'STALE') reasons.push(`STALE_MARK:${label}`)
          if (!provenance.provider || provenance.provider === 'unknown' || provenance.sourceCount < 1) reasons.push(`MISSING_PROVIDER_PROVENANCE:${label}`)
          if (provenance.fallbackUsed || provenance.mock) reasons.push(`FALLBACK_OR_MOCK_MARK:${label}`)
          if (provenance.dataStatus !== 'LIVE') reasons.push(`UNQUALIFIED_MARK_STATUS:${label}`)
          if (String(quote.symbol ?? '').trim().toUpperCase() !== positions[index].symbol
            || normalizeAssetType(quote.assetType) !== positions[index].assetType) reasons.push(`UNRESOLVED_INSTRUMENT_OR_MULTIPLIER:${label}`)
          return {
            ...identity.manifest,
            mark: {
              price,
              timestamp: markTimestamp,
              provider: provenance.provider,
              sourceProvenance: provenance,
              fallbackUsed: provenance.fallbackUsed,
              mock: provenance.mock,
              dataStatus: provenance.dataStatus,
            },
          }
        })

        const finalAccountRow = await loadAccount(client, scope, false)
        const finalPositionRows = finalAccountRow ? await loadPositions(client, finalAccountRow, false) : []
        if (!finalAccountRow || Number(finalAccountRow.revision) !== account.revision || Number(finalAccountRow.cash) !== account.cash
          || positionSignature(finalPositionRows) !== initialSignature) reasons.push('ACCOUNT_REVISION_RACE')
        const finalReasons = unique(reasons)
        const unavailable = finalReasons.some((reason) => /^(ACCOUNTING_ORIGIN_UNAVAILABLE|MISSING_MARK|STALE_MARK|FUTURE_DATED_MARK|FALLBACK_OR_MOCK_MARK|MISSING_PROVIDER_PROVENANCE|UNQUALIFIED_MARK_STATUS|INVALID_MARK_NUMERIC)/.test(reason))
        const completenessStatus = finalReasons.length ? (unavailable ? EQUITY_OBSERVATION_STATUS.unavailable : EQUITY_OBSERVATION_STATUS.incomplete) : EQUITY_OBSERVATION_STATUS.complete
        const positionManifest = {
          status: finalReasons.some((reason) => reason.startsWith('INCOMPLETE_POSITION_EVIDENCE') || reason.startsWith('INVALID_POSITION')
            || reason.startsWith('UNRESOLVED_INSTRUMENT') || reason.startsWith('UNSUPPORTED_DENOMINATION')) ? 'INCOMPLETE' : 'COMPLETE',
          count: manifestPositions.length,
          positions: manifestPositions,
        }
        const signedMarkedValue = completenessStatus === EQUITY_OBSERVATION_STATUS.complete
          ? calculateCanonicalSignedMarkedValue(manifestPositions.map((position) => ({
            assetType: position.instrument.assetType,
            side: position.side,
            quantity: position.quantity,
            currentPrice: position.mark.price,
          })))
          : null
        const equity = completenessStatus === EQUITY_OBSERVATION_STATUS.complete ? rounded(account.cash + signedMarkedValue) : null
        const orderResult = await client.query(
          `SELECT COALESCE(MAX(observation_order),0) AS latest_order
           FROM atlas_paper_equity_observations WHERE account_record_id=$1`,
          [account.recordId],
        )
        const observationOrder = Number(orderResult.rows?.[0]?.latest_order ?? 0) + 1
        const observationId = `paper-equity-observation-${randomUUID()}`
        const inserted = await client.query(
          `INSERT INTO atlas_paper_equity_observations
            (id,account_record_id,organization_id,team_workspace_id,account_id,user_id,account_revision,observation_order,
             valuation_timestamp,accounting_origin_id,accounting_cutoff_evidence_id,accounting_cutoff_revision,
             funding_cutoff_evidence_id,funding_cutoff_revision,canonical_cash,denomination,position_manifest,
             signed_marked_value,equity,valuation_policy_version,completeness_status,reasons,operation_idempotency_key,recorded_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,clock_timestamp())
           RETURNING *`,
          [observationId, account.recordId, scope.organizationId, scope.teamWorkspaceId, scope.accountId, scope.userId,
            account.revision, observationOrder, valuationTimestamp, account.accountingOriginId,
            cutoff.accountingCutoff?.evidenceId ?? null, cutoff.accountingCutoff?.revision ?? null,
            cutoff.fundingCutoff?.evidenceId ?? null, cutoff.fundingCutoff?.revision ?? null,
            account.cash, EQUITY_VALUATION_DENOMINATION, positionManifest, signedMarkedValue, equity,
            EQUITY_VALUATION_POLICY_VERSION, completenessStatus, finalReasons, idempotencyKey],
        )
        if (!inserted.rows?.[0]) throw observationError(EQUITY_OBSERVATION_ERRORS.persistence, 'Equity observation was not durably persisted.')
        return { ok: true, duplicate: false, observation: observationFromRow(inserted.rows[0]) }
      })
    },

    async list(input = {}) {
      const scope = normalizedScope(input)
      const result = await database.query(
        `SELECT * FROM atlas_paper_equity_observations
         WHERE organization_id=$1 AND team_workspace_id=$2 AND account_id=$3 AND user_id=$4
         ORDER BY observation_order ASC`,
        [scope.organizationId, scope.teamWorkspaceId, scope.accountId, scope.userId],
      )
      return (result.rows ?? []).map(observationFromRow)
    },
  }
}
