function safeClaimDiagnostics(value) {
  if (!value || typeof value !== 'object') return null
  return {
    workerEntered: value.workerEntered === true,
    scopedPreparationLoaded: value.scopedPreparationLoaded === true,
    physicalStatusMatchesExpected: value.physicalStatusMatchesExpected === true,
    physicalClaimTokenMatchesExpected: value.physicalClaimTokenMatchesExpected === true,
    conditionalUpdateAttempted: value.conditionalUpdateAttempted === true,
    claimSucceeded: value.claimSucceeded === true,
  }
}

// Deliberately nonvisual: permits authenticated runtime verification without
// rendering lifecycle internals or ever exposing the raw claim token.
export function publishGovernedReviewRuntimeMetadata(data = {}) {
  if (typeof globalThis === 'undefined') return
  const current = globalThis.__ATLAS_GOVERNED_REVIEW_PREPARATION__ ?? {}
  const metadata = {
    ...current,
    preparationId: data.preparationId ?? current.preparationId ?? null,
    status: data.status ?? current.status ?? null,
    attempt: Number.isInteger(data.attempt) ? data.attempt : (current.attempt ?? 0),
    claimTokenPresent: typeof data.claimTokenPresent === 'boolean' ? data.claimTokenPresent : (current.claimTokenPresent ?? false),
    ...(data.claimDiagnostics ? { claimDiagnostics: safeClaimDiagnostics(data.claimDiagnostics) } : {}),
    ...(typeof data.reused === 'boolean' ? { reused: data.reused } : {}),
  }
  globalThis.__ATLAS_GOVERNED_REVIEW_PREPARATION__ = metadata
  globalThis.document?.documentElement?.setAttribute('data-atlas-governed-review-preparation', JSON.stringify(metadata))
}
