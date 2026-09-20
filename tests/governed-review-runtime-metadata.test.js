import { afterEach, describe, expect, it } from 'vitest'
import { publishGovernedReviewRuntimeMetadata } from '../src/workspaces/Scanner/governedReviewRuntimeMetadata.js'

describe('governed review runtime metadata', () => {
  afterEach(() => { delete globalThis.__ATLAS_GOVERNED_REVIEW_PREPARATION__ })

  it('retains only safe lifecycle observability fields and never a raw claim token', () => {
    publishGovernedReviewRuntimeMetadata({ preparationId: 'prep-1', status: 'pending', reused: false })
    publishGovernedReviewRuntimeMetadata({
      preparationId: 'prep-1',
      status: 'running',
      attempt: 1,
      claimTokenPresent: true,
      claimToken: 'must-not-appear',
      claimDiagnostics: {
        workerEntered: true,
        scopedPreparationLoaded: true,
        physicalStatusMatchesExpected: false,
        physicalClaimTokenMatchesExpected: false,
        conditionalUpdateAttempted: true,
        claimSucceeded: false,
        claimToken: 'must-not-appear',
      },
    })

    expect(globalThis.__ATLAS_GOVERNED_REVIEW_PREPARATION__).toEqual({
      preparationId: 'prep-1', status: 'running', attempt: 1, claimTokenPresent: true, reused: false,
      claimDiagnostics: {
        workerEntered: true,
        scopedPreparationLoaded: true,
        physicalStatusMatchesExpected: false,
        physicalClaimTokenMatchesExpected: false,
        conditionalUpdateAttempted: true,
        claimSucceeded: false,
      },
    })
    expect(JSON.parse(document.documentElement.getAttribute('data-atlas-governed-review-preparation'))).toEqual({
      preparationId: 'prep-1', status: 'running', attempt: 1, claimTokenPresent: true, reused: false,
      claimDiagnostics: {
        workerEntered: true,
        scopedPreparationLoaded: true,
        physicalStatusMatchesExpected: false,
        physicalClaimTokenMatchesExpected: false,
        conditionalUpdateAttempted: true,
        claimSucceeded: false,
      },
    })
  })
})
