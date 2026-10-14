import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { createPostgresRepository } from '../lib/db/postgresRepository.js'

vi.mock('../netlify/functions/_shared/authApi.js', () => ({
  createOrganizationAuthenticatedApiHandler: (resolver) => resolver,
}))

const api = vi.hoisted(() => ({
  startGovernedReviewPreparation: vi.fn(),
  getGovernedReviewPreparationStatus: vi.fn(),
  discoverGovernedReviewPreparation: vi.fn(),
}))

vi.mock('../src/api/workspaceApiClient.js', () => ({ workspaceApiClient: api }))

import { GovernedReviewQueue } from '../src/workspaces/Scanner/scannerSections.jsx'
import { clearGovernedReviewRuntimeMetadata } from '../src/workspaces/Scanner/governedReviewRuntimeMetadata.js'
import { handler as readStatus } from '../netlify/functions/governed-review-status.js'

let root
let container

async function renderQueue() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root.render(<GovernedReviewQueue />))
}

async function startQueue() {
  await act(async () => {
    container.querySelector('button').click()
  })
}

async function nextPoll() {
  await act(async () => vi.advanceTimersByTimeAsync(3000))
}

const status = (value) => ({ ok: true, data: { preparationId: 'prep-current', ...value } })
const symbols = ['SPY', 'QQQ', 'IWM', 'AAPL', 'MSFT']
const strategies = [
  ['BREAKOUT.1', 'breakout-momentum-v1'],
  ['RANGE.1', 'range-mean-reversion-v1'],
  ['VOL.1', 'volatility-expansion-v1'],
]
const checksWith = (disposition) => symbols.flatMap((symbol) => strategies.map(([experimentId, strategyId]) => {
  const { status: checkStatus, reason } = disposition(symbol, experimentId)
  return { checkId: `${symbol}-${experimentId}`, symbol, strategyId, experimentId, status: checkStatus, reason }
}))
const noCandidateChecks = checksWith(() => ({ status: 'COMPLETED_NO_CANDIDATE', reason: 'signal_rejected' }))
const completeCoverage = {
  checks: noCandidateChecks,
  summary: { status: 'COMPLETE', expected: 15, evaluated: 15, completedCandidate: 0, completedNoCandidate: 15, blockedDegraded: 0, missedNotEvaluated: 0 },
}

beforeEach(() => {
  localStorage.removeItem('atlas-governed-review-uncertain-start')
  vi.useFakeTimers()
  api.startGovernedReviewPreparation.mockReset()
  api.getGovernedReviewPreparationStatus.mockReset()
  api.discoverGovernedReviewPreparation.mockReset()
  api.discoverGovernedReviewPreparation.mockResolvedValue({ ok: true, data: { discoveryStatus: 'NONE_ACTIVE', preparationId: null, status: 'none_active' } })
  api.startGovernedReviewPreparation.mockResolvedValue(status({ status: 'pending' }))
})

afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
  root = null
  container = null
  clearGovernedReviewRuntimeMetadata()
  localStorage.removeItem('atlas-governed-review-uncertain-start')
  vi.useRealTimers()
})

describe('governed review result visibility', () => {
  it('recovers a running preparation after reload without dispatching another', async () => {
    api.discoverGovernedReviewPreparation.mockResolvedValue(status({ discoveryStatus: 'RUNNING', status: 'running' }))
    api.getGovernedReviewPreparationStatus.mockResolvedValue(status({ status: 'running' }))

    await renderQueue()

    expect(container.textContent).toContain('Preparation prep-current · running')
    expect(container.querySelector('button').disabled).toBe(true)
    expect(api.startGovernedReviewPreparation).not.toHaveBeenCalled()
    expect(api.getGovernedReviewPreparationStatus).toHaveBeenCalledWith('prep-current')
  })

  it('keeps Prepare disabled when durable discovery is unavailable', async () => {
    api.discoverGovernedReviewPreparation.mockResolvedValue({ ok: true, data: { discoveryStatus: 'UNKNOWN', preparationId: null, status: 'unknown' } })

    await renderQueue()

    expect(container.textContent).toContain('Current durable preparation status is unknown')
    expect(container.textContent).toContain('Retry status')
    expect(container.querySelector('button').disabled).toBe(true)
    expect(api.startGovernedReviewPreparation).not.toHaveBeenCalled()
  })

  it('uses read-only recovery after an uncertain start response', async () => {
    api.startGovernedReviewPreparation.mockRejectedValue(new Error('Connection lost'))
    api.discoverGovernedReviewPreparation
      .mockResolvedValueOnce({ ok: true, data: { discoveryStatus: 'NONE_ACTIVE', preparationId: null, status: 'none_active' } })
      .mockResolvedValueOnce(status({ discoveryStatus: 'PENDING', status: 'pending' }))
    api.getGovernedReviewPreparationStatus.mockResolvedValue(status({ status: 'pending' }))

    await renderQueue()
    await startQueue()

    expect(container.textContent).toContain('Preparation prep-current · pending')
    expect(container.querySelector('button').disabled).toBe(true)
    expect(api.startGovernedReviewPreparation).toHaveBeenCalledTimes(1)
  })

  it('never offers a second POST when an uncertain start is followed by an empty lookup, even after reload', async () => {
    api.startGovernedReviewPreparation.mockRejectedValue(new Error('Connection lost'))

    await renderQueue()
    await startQueue()

    expect(api.startGovernedReviewPreparation).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('another start is blocked')
    expect(container.querySelector('button').disabled).toBe(true)
    expect(localStorage.getItem('atlas-governed-review-uncertain-start')).toMatch(/^[A-Za-z0-9._:-]{16,128}$/)

    await act(async () => root.unmount())
    container.remove()
    root = null
    container = null
    await renderQueue()

    expect(container.querySelector('button').disabled).toBe(true)
    expect(api.startGovernedReviewPreparation).toHaveBeenCalledTimes(1)
  })

  it('does not treat an older terminal record as resolution of an uncertain start', async () => {
    api.startGovernedReviewPreparation.mockRejectedValue(new Error('Connection lost'))
    api.discoverGovernedReviewPreparation
      .mockResolvedValueOnce({ ok: true, data: { discoveryStatus: 'NONE_ACTIVE', preparationId: null, status: 'none_active' } })
      .mockResolvedValueOnce(status({ discoveryStatus: 'COMPLETED', status: 'completed', queueItems: [], observationCoverage: completeCoverage }))

    await renderQueue()
    await startQueue()

    expect(container.textContent).toContain('A prior terminal record does not resolve it')
    expect(container.textContent).not.toContain('found no legitimate matches')
    expect(container.querySelector('button').disabled).toBe(true)
    expect(api.startGovernedReviewPreparation).toHaveBeenCalledTimes(1)
  })

  it('reconciles a terminal response to the same logical request and allows a later explicit start', async () => {
    api.startGovernedReviewPreparation.mockRejectedValueOnce(new Error('Connection lost'))
    api.discoverGovernedReviewPreparation
      .mockResolvedValueOnce({ ok: true, data: { discoveryStatus: 'NONE_ACTIVE', preparationId: null, status: 'none_active' } })
      .mockResolvedValueOnce(status({ discoveryStatus: 'COMPLETED', status: 'completed', requestMatched: true, queueItems: [], observationCoverage: completeCoverage }))

    await renderQueue()
    await startQueue()

    expect(container.textContent).toContain('Preparation prep-current · completed')
    expect(container.querySelector('button').disabled).toBe(false)
    expect(localStorage.getItem('atlas-governed-review-uncertain-start')).toBeNull()
    expect(api.startGovernedReviewPreparation).toHaveBeenCalledTimes(1)
    expect(api.discoverGovernedReviewPreparation.mock.calls[1][0]).toBe(api.startGovernedReviewPreparation.mock.calls[0][0])
  })

  it('sends only one POST for repeated clicks before the first response arrives', async () => {
    api.startGovernedReviewPreparation.mockReturnValue(new Promise(() => {}))

    await renderQueue()
    await act(async () => {
      container.querySelector('button').click()
      container.querySelector('button').click()
    })

    expect(api.startGovernedReviewPreparation).toHaveBeenCalledTimes(1)
    expect(container.querySelector('button').disabled).toBe(true)
  })

  it('recovers a completed no-candidate result only with complete coverage', async () => {
    api.discoverGovernedReviewPreparation.mockResolvedValue(status({
      discoveryStatus: 'COMPLETED', status: 'completed', queueItems: [], observationCoverage: completeCoverage,
    }))

    await renderQueue()

    expect(container.textContent).toContain('Preparation prep-current · completed')
    expect(container.textContent).toContain('found no legitimate matches')
    expect(container.querySelectorAll('[aria-label="Governed observation results"] li')).toHaveLength(15)
    expect(api.startGovernedReviewPreparation).not.toHaveBeenCalled()
  })

  it('recovers all fifteen server-supplied dispositions, exact SPY reasons, and candidate identity only from queueItems', async () => {
    const checks = checksWith((symbol) => symbol === 'SPY'
      ? { status: 'BLOCKED_DEGRADED', reason: 'candle_evidence_missing' }
      : symbol === 'IWM'
        ? { status: 'COMPLETED_CANDIDATE', reason: 'candidate_created' }
        : { status: 'COMPLETED_NO_CANDIDATE', reason: 'signal_rejected' })
    const response = status({
      discoveryStatus: 'COMPLETED', status: 'completed',
      observationCoverage: { checks, summary: { status: 'DEGRADED', expected: 15, evaluated: 15, completedCandidate: 3, completedNoCandidate: 9, blockedDegraded: 3, missedNotEvaluated: 0 } },
      observationAttention: { required: true, status: 'DEGRADED', count: 3, checks: checks.slice(0, 3) },
      queueItems: [{ symbol: 'IWM', strategyId: 'breakout-momentum-v1', quality: { score: 72, opportunityId: 'opp-stored-1' } }],
    })
    api.discoverGovernedReviewPreparation.mockResolvedValue(response)

    await renderQueue()

    const results = container.querySelectorAll('[aria-label="Governed observation results"] li')
    expect(results).toHaveLength(15)
    expect([...results].filter((row) => row.textContent.includes('SPY'))).toHaveLength(3)
    expect([...results].filter((row) => row.textContent.includes('SPY'))).toEqual([
      expect.objectContaining({ textContent: expect.stringContaining('BREAKOUT.1 (breakout-momentum-v1) · BLOCKED_DEGRADED · candle_evidence_missing') }),
      expect.objectContaining({ textContent: expect.stringContaining('RANGE.1 (range-mean-reversion-v1) · BLOCKED_DEGRADED · candle_evidence_missing') }),
      expect.objectContaining({ textContent: expect.stringContaining('VOL.1 (volatility-expansion-v1) · BLOCKED_DEGRADED · candle_evidence_missing') }),
    ])
    expect([...results].filter((row) => row.textContent.includes('IWM') && row.textContent.includes('COMPLETED_CANDIDATE'))).toHaveLength(3)
    expect([...results].filter((row) => ['QQQ', 'AAPL', 'MSFT'].some((symbol) => row.textContent.includes(symbol)) && row.textContent.includes('COMPLETED_NO_CANDIDATE'))).toHaveLength(9)
    expect(container.textContent).toContain('Candidate ID: opp-stored-1')
    expect(container.textContent).not.toContain('No governed strategy opportunities')
    expect(api.startGovernedReviewPreparation).not.toHaveBeenCalled()
    expect(api.getGovernedReviewPreparationStatus).not.toHaveBeenCalled()

    await act(async () => root.unmount())
    container.remove()
    root = null
    container = null
    await renderQueue()
    expect(container.querySelectorAll('[aria-label="Governed observation results"] li')).toHaveLength(15)
    expect(container.textContent).toContain('Candidate ID: opp-stored-1')
    expect(api.startGovernedReviewPreparation).not.toHaveBeenCalled()
  })

  it('shows unknown for missing or malformed stored checks and never infers candidate identity from a check', async () => {
    const checks = noCandidateChecks.slice(0, 14).map((check, index) => index === 0 ? { ...check, status: 'NOT_A_STATUS' } : check)
    api.discoverGovernedReviewPreparation.mockResolvedValue(status({
      discoveryStatus: 'COMPLETED', status: 'completed', queueItems: [],
      observationCoverage: { ...completeCoverage, checks },
      observationAttention: { required: false, status: 'COMPLETE', count: 0, checks: [] },
    }))

    await renderQueue()

    const results = container.querySelectorAll('[aria-label="Governed observation results"] li')
    expect(results).toHaveLength(15)
    expect([...results].filter((row) => row.textContent.includes('UNKNOWN · stored_check_unavailable'))).toHaveLength(2)
    expect(container.textContent).toContain('Some stored check details are unavailable or malformed')
    expect(container.textContent).not.toContain('found no legitimate matches')
    expect(container.textContent).not.toContain('Candidate ID:')
    expect(api.startGovernedReviewPreparation).not.toHaveBeenCalled()
  })

  it('does not turn a stored candidate disposition without a queue item into no candidate or an invented ID', async () => {
    const checks = checksWith((symbol, experimentId) => symbol === 'SPY' && experimentId === 'BREAKOUT.1'
      ? { status: 'COMPLETED_CANDIDATE', reason: 'candidate_created' }
      : { status: 'COMPLETED_NO_CANDIDATE', reason: 'signal_rejected' })
    api.discoverGovernedReviewPreparation.mockResolvedValue(status({
      discoveryStatus: 'COMPLETED', status: 'completed', queueItems: [],
      observationCoverage: { checks, summary: { status: 'COMPLETE', expected: 15, evaluated: 15, completedCandidate: 1, completedNoCandidate: 14, blockedDegraded: 0, missedNotEvaluated: 0 } },
      observationAttention: { required: false, status: 'COMPLETE', count: 0, checks: [] },
    }))

    await renderQueue()

    expect(container.querySelectorAll('[aria-label="Governed observation results"] li')).toHaveLength(15)
    expect(container.textContent).toContain('SPY · BREAKOUT.1 (breakout-momentum-v1) · COMPLETED_CANDIDATE')
    expect(container.textContent).toContain('No candidate conclusion is available from the stored check results and queue items.')
    expect(container.textContent).not.toContain('found no legitimate matches')
    expect(container.textContent).not.toContain('Candidate ID:')
    expect(api.startGovernedReviewPreparation).not.toHaveBeenCalled()
  })

  it('keeps the accepted operation identified and nonterminal until the server reports completion with degraded evidence', async () => {
    const checks = ['SPY', 'QQQ', 'IWM', 'AAPL', 'MSFT'].flatMap((symbol) =>
      ['BREAKOUT.1', 'RANGE.1', 'VOL.1'].map((experimentId) => ({
        checkId: `${symbol}-${experimentId}`, symbol, experimentId,
        status: 'BLOCKED_DEGRADED', reason: 'quote_evidence_missing',
      })))
    api.getGovernedReviewPreparationStatus
      .mockResolvedValueOnce(status({ status: 'pending' }))
      .mockResolvedValueOnce(status({ status: 'running' }))
      .mockResolvedValueOnce(status({
        status: 'completed',
        queueItems: [],
        observationCoverage: { summary: { status: 'DEGRADED', expected: 15, evaluated: 15, blockedDegraded: 15, missedNotEvaluated: 0 } },
        observationAttention: { required: true, status: 'DEGRADED', count: 15, checks },
      }))

    await renderQueue()
    await startQueue()
    expect(container.textContent).toContain('Preparation prep-current · pending')
    expect(container.textContent).toContain('Accepted and queued; evaluation has not completed.')
    expect(container.querySelector('button').disabled).toBe(true)

    await nextPoll()
    expect(container.textContent).toContain('Preparation prep-current · running')
    expect(container.textContent).toContain('no terminal outcome yet')
    expect(container.querySelector('button').disabled).toBe(true)

    await nextPoll()
    expect(container.textContent).toContain('Preparation prep-current · completed')
    expect(container.textContent).toContain('quote_evidence_missing')
    expect(container.querySelectorAll('[aria-label="Governed observation coverage attention"] li')).toHaveLength(15)
    expect(container.textContent).toContain('No candidate conclusion is available')
    expect(container.textContent).not.toContain('found no legitimate matches')
    expect(container.querySelector('button').disabled).toBe(false)
    await nextPoll()
    expect(api.getGovernedReviewPreparationStatus).toHaveBeenCalledTimes(3)
  })

  it('states no candidate only after completed full evaluation coverage', async () => {
    api.getGovernedReviewPreparationStatus.mockResolvedValue(status({
      status: 'completed', queueItems: [], observationCoverage: completeCoverage,
      observationAttention: { required: false, status: 'COMPLETE', count: 0, checks: [] },
    }))

    await renderQueue()
    await startQueue()
    expect(container.textContent).toContain('Preparation prep-current · completed')
    expect(container.textContent).toContain('found no legitimate matches')
    expect(container.textContent).toContain('Ready — 0 governed matches')
  })

  it('keeps a poll error nonterminal', async () => {
    api.getGovernedReviewPreparationStatus.mockResolvedValueOnce({ ok: false, error: { code: 'unavailable' } })

    await renderQueue()
    await startQueue()
    expect(container.textContent).toContain('Preparation prep-current · pending')
    expect(container.textContent).toContain('status is unavailable; retrying')
    expect(container.querySelector('button').disabled).toBe(true)
    expect(container.textContent).not.toContain('found no legitimate matches')
    expect(JSON.parse(document.documentElement.getAttribute('data-atlas-governed-review-preparation')).preparationId).toBe('prep-current')
  })

  it('does not replace a terminal result with an older in-flight status response', async () => {
    let resolveOlderPoll
    api.getGovernedReviewPreparationStatus
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOlderPoll = resolve }))
      .mockResolvedValueOnce(status({
        status: 'completed', queueItems: [], observationCoverage: completeCoverage,
      }))

    await renderQueue()
    await startQueue()
    expect(container.textContent).toContain('Preparation prep-current · pending')

    await nextPoll()
    expect(container.textContent).toContain('Preparation prep-current · completed')
    expect(container.textContent).toContain('found no legitimate matches')

    await act(async () => resolveOlderPoll(status({ status: 'running' })))
    expect(container.textContent).toContain('Preparation prep-current · completed')
    expect(container.textContent).toContain('found no legitimate matches')
    expect(container.querySelectorAll('[aria-label="Governed observation results"] li')).toHaveLength(15)
    expect(JSON.parse(document.documentElement.getAttribute('data-atlas-governed-review-preparation')).status).toBe('completed')
  })

  it('removes the prior result and identifier when starting a later preparation', async () => {
    api.getGovernedReviewPreparationStatus
      .mockResolvedValueOnce(status({ status: 'completed', queueItems: [], observationCoverage: completeCoverage }))
      .mockResolvedValueOnce(new Promise(() => {}))

    await renderQueue()
    await startQueue()
    expect(container.textContent).toContain('found no legitimate matches')

    api.startGovernedReviewPreparation.mockResolvedValueOnce(status({ preparationId: 'prep-next', status: 'pending' }))
    await startQueue()
    expect(container.textContent).toContain('Preparation prep-next · pending')
    expect(container.textContent).not.toContain('prep-current')
    expect(container.textContent).not.toContain('found no legitimate matches')
    expect(JSON.parse(document.documentElement.getAttribute('data-atlas-governed-review-preparation')).preparationId).toBe('prep-next')
  })
})

describe('governed review durable discovery', () => {
  const scope = { organizationId: 'org-owner', teamWorkspaceId: 'workspace-a', userId: 'owner' }
  const preparation = {
    id: 'prep-current', organizationId: scope.organizationId, userId: scope.userId,
    status: 'running', claimToken: 'secret-claim',
    tenantContext: scope, createdAt: '2026-10-13T17:40:00.000Z',
  }

  it('selects an unexpired active record first using server-owned org, workspace, and user scope', async () => {
    const query = vi.fn(async () => ({ rows: [{ id: preparation.id, payload: preparation, status: 'running' }] }))
    const repository = createPostgresRepository({ database: { connected: true, query } })
    const result = await readStatus({
      body: {}, query: { organizationId: scope.organizationId, userId: 'attacker', teamWorkspaceId: 'workspace-b' },
      repository, tenantContext: scope, user: { id: scope.userId }, organizationId: scope.organizationId,
    })

    expect(result.data).toMatchObject({ discoveryStatus: 'RUNNING', preparationId: preparation.id, status: 'running' })
    expect(JSON.stringify(result)).not.toContain('secret-claim')
    expect(query).toHaveBeenCalledTimes(1)
    expect(query.mock.calls[0][1]).toEqual([scope.organizationId, scope.teamWorkspaceId, scope.userId])
    expect(query.mock.calls[0][0]).toContain("status IN ('pending', 'running')")
    expect(query.mock.calls[0][0]).toContain('expires_at > NOW()')
  })

  it('distinguishes an empty scoped store from unavailable storage', async () => {
    const context = { body: {}, query: {}, tenantContext: scope, user: { id: scope.userId }, organizationId: scope.organizationId }
    const empty = createPostgresRepository({ database: { connected: true, query: vi.fn(async () => ({ rows: [] })) } })
    const unavailable = createPostgresRepository({ database: { connected: false, query: vi.fn() } })

    expect((await readStatus({ ...context, repository: empty })).data).toMatchObject({ discoveryStatus: 'NONE_ACTIVE', preparationId: null })
    expect((await readStatus({ ...context, repository: unavailable })).data).toMatchObject({ discoveryStatus: 'UNKNOWN', preparationId: null })
  })

  it('recovers a terminal request by key only within its server-derived tenant scope', async () => {
    const completed = { ...preparation, status: 'completed', idempotencyKey: 'logical-request-0001' }
    const query = vi.fn(async (sql, params) => ({ rows: params[0] === scope.organizationId && params[1] === scope.teamWorkspaceId
      && params[2] === scope.userId && params[3] === completed.idempotencyKey
      ? [{ id: completed.id, payload: completed, status: 'completed' }] : [] }))
    const repository = createPostgresRepository({ database: { connected: true, query } })
    const context = { body: {}, query: { organizationId: scope.organizationId, idempotencyKey: completed.idempotencyKey }, repository,
      tenantContext: scope, user: { id: scope.userId }, organizationId: scope.organizationId }

    const found = await readStatus(context)
    expect(found.data).toMatchObject({ discoveryStatus: 'COMPLETED', preparationId: completed.id, requestMatched: true })
    expect(JSON.stringify(found)).not.toContain('secret-claim')
    const otherTenant = await readStatus({ ...context, tenantContext: { ...scope, teamWorkspaceId: 'workspace-b' } })
    expect(otherTenant.data).toMatchObject({ discoveryStatus: 'UNKNOWN', preparationId: null })
  })

  it.each(['pending', 'running', 'completed', 'failed'])('reports durable %s without caller supplied identity', async (durableStatus) => {
    const record = { ...preparation, status: durableStatus }
    const repository = createPostgresRepository({ database: {
      connected: true,
      query: vi.fn(async () => ({ rows: [{ id: record.id, payload: record, status: durableStatus }] })),
    } })
    const result = await readStatus({
      body: {}, query: { preparationId: undefined, userId: 'attacker' }, repository,
      tenantContext: scope, user: { id: scope.userId }, organizationId: scope.organizationId,
    })

    expect(result.data).toMatchObject({ discoveryStatus: durableStatus.toUpperCase(), preparationId: record.id, status: durableStatus })
  })
})
