import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AtlasCopilotPanel } from '../src/components/AtlasCopilotPanel.jsx'
import { workspaceApiClient } from '../src/api/workspaceApiClient.js'
import { loadAtlasGrounding } from '../lib/ai/atlasServerGrounding.js'
import { runGroundedAdvisory } from '../lib/ai/atlasGroundedAdvisory.js'
import { CASESET, SCOPE, caseRepositories } from '../scripts/evaluate-gap7-grounding.mjs'
let root; let container
const MetricCard = ({ label, value }) => <p>{label}: {value}</p>
afterEach(() => { act(() => root?.unmount()); container?.remove(); vi.restoreAllMocks() })
describe('Gap 7 rendered server advisory', () => {
  it('renders exact server facts, unavailable confidence, truthful metadata and no browser authority', async () => {
    const grounding = await loadAtlasGrounding({ ...SCOPE, ...caseRepositories(CASESET.cases[1]), generatedAt: CASESET.generatedAt })
    const result = await runGroundedAdvisory({ ...SCOPE, grounding, question: 'Review', requestCategory: 'portfolio_summary' })
    const request = vi.spyOn(workspaceApiClient, 'askAtlasCopilot').mockResolvedValue(result)
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
    await act(async () => root.render(<AtlasCopilotPanel MetricCard={MetricCard} atlasDecisionContext={{ selectedPlan: { decisionStatus: 'READY' } }} portfolioSummary={{ equity: 999999 }} />))
    expect(container.textContent).toContain('Confidence: UNAVAILABLE')
    expect(container.textContent).not.toContain('READY')
    await act(async () => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(request.mock.calls[0][0]).toEqual({ question: 'Summarize my current paper portfolio.', requestCategory: 'portfolio_summary' })
    expect(container.textContent).toContain('atlas-mock-grounded-references-v1')
    for (const fact of result.atlasAiResponse.facts) {
      const displayed = container.querySelector(`[aria-label="${fact.id} evidence"] pre`).textContent
      if (fact.status === 'AVAILABLE') expect(JSON.parse(displayed)).toEqual(fact.value)
      else expect(displayed).toContain('UNAVAILABLE')
    }
    expect(container.textContent).toContain('98.7654321')
    expect(container.textContent).toContain('STALE')
    expect(container.textContent).toContain('BLOCKED')
    expect(container.textContent).not.toContain('999999')
    request.mockRejectedValueOnce(new Error('provider or endpoint unavailable'))
    await act(async () => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(container.querySelector('[role="alert"]').textContent).toContain('unavailable')
    expect(container.textContent).toContain('AI Health: degraded')
    expect(container.querySelector('[aria-label="prices evidence"]')).toBeNull()
  })
})
