import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

const api = vi.hoisted(() => ({
  startGovernedReviewPreparation: vi.fn(),
  getGovernedReviewPreparationStatus: vi.fn(),
}))

vi.mock('../src/api/workspaceApiClient.js', () => ({ workspaceApiClient: api }))

import { GovernedReviewQueue } from '../src/workspaces/Scanner/scannerSections.jsx'
import { clearGovernedReviewRuntimeMetadata } from '../src/workspaces/Scanner/governedReviewRuntimeMetadata.js'

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
const completeCoverage = {
  summary: { status: 'COMPLETE', expected: 15, evaluated: 15, blockedDegraded: 0, missedNotEvaluated: 0 },
}

beforeEach(() => {
  vi.useFakeTimers()
  api.startGovernedReviewPreparation.mockReset()
  api.getGovernedReviewPreparationStatus.mockReset()
  api.startGovernedReviewPreparation.mockResolvedValue(status({ status: 'pending' }))
})

afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
  root = null
  container = null
  clearGovernedReviewRuntimeMetadata()
  vi.useRealTimers()
})

describe('governed review result visibility', () => {
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
