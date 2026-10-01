import { INDEX_PULLBACK_EXIT_POLICY_DEFINITION_FINGERPRINT, INDEX_PULLBACK_EXIT_POLICY_VERSION, INDEX_PULLBACK_STRATEGY_VERSION } from './indexPullbackExitPolicy.js'

export const EDGE2_ACTIVATION_MANIFEST_VERSION = 'edge2-activation-manifest-v1'
export const EDGE2_FROZEN_PROTOCOL_ID = 'EDGE.2-forward-evaluation-v1'
export const EDGE2_FROZEN_PROTOCOL_FINGERPRINT = '053ead2b554b41cd1c9a57c3898383f98d6d95ebf93d1f2d81b7b6233de7b0b1'

const REQUIRED_POWER_INPUTS = Object.freeze([
  'dispersionAssumption',
  'dependenceAssumption',
  'validCandidateRate',
  'entryRate',
  'completionRate',
  'attritionAllowance',
])

function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((output, key) => {
      if (!/raw|secret|token|credential|password|apikey/i.test(key)) output[key] = stable(value[key])
      return output
    }, {})
  }
  return value
}

export function fingerprintEdge2ActivationManifest(value) {
  const source = JSON.stringify(stable(value))
  return Array.from({ length: 8 }, (_, seed) => {
    let hash = (0x811c9dc5 ^ Math.imul(seed + 1, 0x9e3779b1)) >>> 0
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index) + seed
      hash = Math.imul(hash, 0x01000193) >>> 0
    }
    return hash.toString(16).padStart(8, '0')
  }).join('')
}

function validIso(value) {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function finite(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
}

function evidenceFingerprint(value) {
  return /^[a-f0-9]{64}$/.test(String(value ?? ''))
}

function prerequisite(blockers, prerequisite, name, expectedStatus) {
  if (prerequisite?.status !== expectedStatus || !evidenceFingerprint(prerequisite?.evidenceFingerprint)) {
    blockers.push(`activation_prerequisite_${name}_unresolved`)
  }
}

export function edge2ActivationBinding(manifest = {}) {
  return Object.freeze({
    activationId: manifest.activationId,
    activationRevision: manifest.revision,
    activationFingerprint: manifest.activationFingerprint,
    protocolId: manifest.protocol?.protocolId,
    protocolFingerprint: manifest.protocol?.protocolFingerprint,
    accountId: manifest.account?.accountId,
  })
}

export function evaluateEdge2Activation(record, { accountId, at } = {}) {
  const manifest = record?.manifest ?? null
  const blockers = []
  if (!manifest) {
    return Object.freeze({ valid: false, collectionAllowed: false, blockers: ['edge2_activation_manifest_missing'], binding: null, manifest: null })
  }

  if (record.serverOwned !== true) blockers.push('edge2_activation_not_server_owned')
  if (record.status !== 'activated' || manifest.status !== 'ACTIVATED') blockers.push('edge2_activation_not_active')
  if (manifest.version !== EDGE2_ACTIVATION_MANIFEST_VERSION || !String(manifest.activationId ?? '').trim() || !Number.isInteger(manifest.revision) || manifest.revision < 1 || manifest.immutable !== true) blockers.push('edge2_activation_version_or_identity_invalid')
  if (manifest.collectionAllowed !== true) blockers.push('edge2_collection_not_allowed')
  if (manifest.protocol?.protocolId !== EDGE2_FROZEN_PROTOCOL_ID || manifest.protocol?.protocolFingerprint !== EDGE2_FROZEN_PROTOCOL_FINGERPRINT) blockers.push('edge2_frozen_protocol_mismatch')
  if (manifest.protocol?.strategyId !== 'index-pullback-v1' || manifest.protocol?.strategyVersion !== INDEX_PULLBACK_STRATEGY_VERSION || !evidenceFingerprint(manifest.protocol?.strategyFingerprint)) blockers.push('edge2_frozen_strategy_mismatch')
  if (manifest.protocol?.exitPolicyVersion !== INDEX_PULLBACK_EXIT_POLICY_VERSION || manifest.protocol?.exitPolicyFingerprint !== INDEX_PULLBACK_EXIT_POLICY_DEFINITION_FINGERPRINT) blockers.push('edge2_frozen_exit_policy_mismatch')

  if (manifest.account?.scope !== 'dedicated_EDGE.2_paper_account' || manifest.account?.paperOnly !== true || manifest.account?.liveBrokerExecution !== false || !String(manifest.account?.accountId ?? '').trim()) blockers.push('edge2_dedicated_paper_account_unbound')
  if (accountId && manifest.account?.accountId !== String(accountId)) blockers.push('edge2_activation_account_mismatch')

  const economics = manifest.economics ?? {}
  const operations = Number(economics.operationsCostDollarsPerLifecycle)
  const capital = Number(economics.capitalCostDollarsPerLifecycle)
  const finalHurdle = Number(economics.finalHurdleR)
  const expectedHurdle = 0.2 + ((operations + capital) / 50)
  if (!finite(operations) || operations < 0 || !finite(capital) || capital < 0 || !finite(finalHurdle) || Math.abs(finalHurdle - expectedHurdle) > 1e-9 || economics.ownerApproved !== true) blockers.push('edge2_economic_hurdle_unapproved')

  const enrollment = manifest.enrollment ?? {}
  const activatedAt = validIso(manifest.activatedAt)
  const startAt = validIso(enrollment.startAt)
  const endAt = validIso(enrollment.endAt)
  const cutoffAt = validIso(enrollment.outcomeCutoffAt)
  const reconciliationEndsAt = validIso(enrollment.reconciliationEndsAt)
  if (activatedAt === null || startAt === null || endAt === null || cutoffAt === null || reconciliationEndsAt === null || startAt < activatedAt || endAt < startAt || cutoffAt < endAt || reconciliationEndsAt < cutoffAt || enrollment.noBackfill !== true) blockers.push('edge2_enrollment_periods_unbound')

  const sampling = manifest.sampling ?? {}
  const powerInputs = sampling.prospectivePowerInputs ?? {}
  const ratesValid = ['validCandidateRate', 'entryRate', 'completionRate'].every((key) => finite(powerInputs[key]) && Number(powerInputs[key]) > 0 && Number(powerInputs[key]) <= 1)
  const assumptionsValid = ['dispersionAssumption', 'dependenceAssumption'].every((key) => finite(powerInputs[key]) && Number(powerInputs[key]) > 0)
  const attritionValid = finite(powerInputs.attritionAllowance) && Number(powerInputs.attritionAllowance) >= 0 && Number(powerInputs.attritionAllowance) < 1
  if (sampling.finalized !== true || sampling.ownerApproved !== true || !REQUIRED_POWER_INPUTS.every((key) => powerInputs[key] !== null && powerInputs[key] !== undefined) || !ratesValid || !assumptionsValid || !attritionValid || !Number.isInteger(sampling.requiredValidSessions) || sampling.requiredValidSessions < 120 || !Number.isInteger(sampling.requiredCompletedLifecycles) || sampling.requiredCompletedLifecycles < 30) blockers.push('edge2_prospective_sampling_power_unfinalized')

  const prerequisites = manifest.prerequisites ?? {}
  prerequisite(blockers, prerequisites.pa4AuthoritativeChronology, 'pa4_authoritative_chronology', 'QUALIFIED')
  prerequisite(blockers, prerequisites.exchangeCalendar, 'exchange_calendar', 'QUALIFIED')
  prerequisite(blockers, prerequisites.dedicatedPaperAccount, 'dedicated_paper_account', 'BOUND')
  prerequisite(blockers, prerequisites.economicHurdle, 'economic_hurdle', 'APPROVED')
  prerequisite(blockers, prerequisites.enrollmentWindow, 'enrollment_window', 'BOUND')
  prerequisite(blockers, prerequisites.prospectiveSamplingPower, 'prospective_sampling_power', 'FINALIZED')
  prerequisite(blockers, prerequisites.frozenConfiguration, 'frozen_configuration', 'MATCHED')

  const core = { ...manifest }
  delete core.activationFingerprint
  const expectedFingerprint = fingerprintEdge2ActivationManifest(core)
  if (!evidenceFingerprint(manifest.activationFingerprint) || manifest.activationFingerprint !== expectedFingerprint) blockers.push('edge2_activation_fingerprint_invalid')

  const uniqueBlockers = [...new Set(blockers)]
  const valid = uniqueBlockers.length === 0
  const observedAt = at === undefined ? null : validIso(at)
  const withinEnrollmentWindow = observedAt === null ? true : startAt !== null && endAt !== null && observedAt >= startAt && observedAt <= endAt
  return Object.freeze({
    valid,
    collectionAllowed: valid && withinEnrollmentWindow,
    blockers: valid && !withinEnrollmentWindow ? ['edge2_enrollment_window_closed'] : uniqueBlockers,
    binding: valid ? edge2ActivationBinding(manifest) : null,
    manifest,
    enrollment: valid ? Object.freeze({ activatedAt: manifest.activatedAt, startAt: enrollment.startAt, endAt: enrollment.endAt, outcomeCutoffAt: enrollment.outcomeCutoffAt, reconciliationEndsAt: enrollment.reconciliationEndsAt }) : null,
  })
}

export function edge2BindingMatches(binding, decision, accountId) {
  if (!decision?.valid || !decision.binding || !binding) return false
  return Object.entries(decision.binding).every(([key, value]) => binding[key] === value)
    && (!accountId || binding.accountId === String(accountId))
}
