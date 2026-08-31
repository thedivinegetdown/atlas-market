import { describe, expect, it, vi } from 'vitest'
import { createWorkspaceApiClient } from '../src/api/workspaceApiClient.js'

const strategies = [
  'index-pullback-v1',
  'breakout-momentum-v1',
  'range-mean-reversion-v1',
  'volatility-expansion-v1',
]

const experiments = ['EDGE.2', 'BREAKOUT.1', 'RANGE.1', 'VOL.1']

describe('Decision Intelligence client projection', () => {
  it('unwraps the authoritative Function response for the hook and UI consumer', async () => {
    const decisionIntelligence = {
      market: {
        status: 'AVAILABLE',
        freshness: 'FRESH',
        context: { participation: { status: 'MIXED' }, sectorLeadership: { leaders: [], laggards: [] } },
      },
      strategyAssessments: strategies.map((strategyId) => ({ strategyId, status: 'NO_TRADE' })),
      observations: experiments.map((experimentId, index) => ({
        experimentId,
        strategyId: strategies[index],
        status: 'NOT_STARTED',
        sessionsElapsed: 0,
        completedOutcomes: 0,
      })),
      evidence: { empiricalConfidence: 'UNAVAILABLE' },
    }
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        data: {
          event: { endpoint: 'decision-intelligence', status: 'AVAILABLE' },
          decisionIntelligence,
          diagnostics: { bounded: true },
          advisoryOnly: true,
          paperTradingOnly: true,
          liveExecutionDisabled: true,
        },
      }),
    })
    const client = createWorkspaceApiClient({ fetchImpl, accessTokenProvider: () => 'test-access-token' })

    const result = await client.getDecisionIntelligence()

    expect(result).toBe(decisionIntelligence)
    expect(result.market.context.participation.status).toBe('MIXED')
    expect(result.strategyAssessments.map((entry) => entry.strategyId)).toEqual(strategies)
    expect(result.observations.map((entry) => entry.experimentId)).toEqual(experiments)
    expect(result.observations.every((entry) => entry.status === 'NOT_STARTED')).toBe(true)
    expect(result.evidence.empiricalConfidence).toBe('UNAVAILABLE')
  })
})
