import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createAtlasAiRepository } from '../lib/ai/atlasAiGateway.js'
import {
  buildOpportunityExplainability,
  rankOpportunityCandidate,
  rankOpportunityCandidates,
  validateOpportunityHistoryFilters,
  validateOpportunityReviewUpdate,
} from '../lib/ai/opportunityAnalysisEngine.js'
import { buildMigrationSql } from '../lib/db/migrations.js'
import { createAtlasAiOpportunitiesHandler } from '../netlify/functions/atlas-ai-opportunities.js'
import { AtlasOpportunityReviewPanel } from '../src/components/AtlasOpportunityReviewPanel.jsx'

const tenantContext = { organizationId: 'org-atlas-local', teamWorkspaceId: null, userId: 'local-development:user-1', role: 'analyst' }

function candidate(extra = {}) {
  return {
    id: extra.id ?? 'opp-aapl',
    symbol: extra.symbol ?? 'AAPL',
    asOf: extra.asOf ?? new Date().toISOString(),
    category: extra.category ?? 'momentum_pullback',
    direction: extra.direction ?? 'long_watch',
    thesis: extra.thesis ?? 'Validated scanner context supports human paper review.',
    timeframe: extra.timeframe ?? 'swing',
    scannerScore: extra.scannerScore ?? 84,
    strategyQualification: extra.strategyQualification ?? 'qualified',
    marketRegime: { regime: 'trending', ...(extra.marketRegime ?? {}) },
    liquiditySummary: { status: 'healthy', spreadPct: 0.05, ...(extra.liquiditySummary ?? {}) },
    riskSummary: { riskLevel: 'medium', score: 35, ...(extra.riskSummary ?? {}) },
    dataQuality: { status: 'healthy', ...(extra.dataQuality ?? {}) },
    missingData: extra.missingData ?? [],
    stale: extra.stale ?? false,
    invalidationConditions: extra.invalidationConditions ?? ['Scanner or liquidity deterioration.'],
    signalSummary: extra.signalSummary ?? 'Momentum and liquidity align.',
    hardRejectionReasons: extra.hardRejectionReasons ?? [],
  }
}

function authEvent(body = {}, role = 'analyst', query = {}) {
  return {
    httpMethod: 'POST',
    headers: {
      authorization: 'Bearer dev-token',
      'x-request-id': 'req-87',
      'content-type': 'application/json',
      'x-csrf-token': 'dev-csrf-token',
      'x-atlas-dev-role': role,
      'x-atlas-dev-subject': 'user-1',
    },
    queryStringParameters: { organizationId: 'org-atlas-local', accountId: 'paper-portfolio', ...query },
    body: JSON.stringify(body),
  }
}

function parse(response) {
  return { ...response, json: response.body ? JSON.parse(response.body) : null }
}

function membership(role = 'analyst', organizationId = 'org-atlas-local') {
  return {
    getMembership: vi.fn(async (requestedOrganizationId) => requestedOrganizationId === organizationId
      ? { role, organizationId, userId: 'local-development:user-1', status: 'active', id: `membership-${role}` }
      : null),
  }
}

function MetricCard({ label, value }) {
  return React.createElement('article', null, React.createElement('span', null, label), React.createElement('strong', null, value))
}

describe('Phase 87A deterministic opportunity ranking', () => {
  it('produces reproducible bounded scores, tier metadata, confidence clamping, and component contributions', () => {
    const first = rankOpportunityCandidate(candidate({ scannerScore: 160 }), { evaluation: { overallStatus: 'passed', warnings: [] } })
    const second = rankOpportunityCandidate(candidate({ scannerScore: 160 }), { evaluation: { overallStatus: 'passed', warnings: [] } })
    expect(first.rankingScore).toBe(second.rankingScore)
    expect(first.rankingScore).toBeGreaterThanOrEqual(0)
    expect(first.rankingScore).toBeLessThanOrEqual(100)
    expect(first.confidence).toBeLessThanOrEqual(1)
    expect(first.rankingVersion).toBe('atlas-opportunity-ranking-v1')
    expect(first.componentContributions.scannerScore.value).toBeGreaterThan(0)
    expect(first.actionable).toBe(false)
  })

  it('applies stale, missing-data, risk, degraded-provider, and rejected-opportunity penalties', () => {
    const healthy = rankOpportunityCandidate(candidate())
    const stale = rankOpportunityCandidate(candidate({ stale: true }))
    const missing = rankOpportunityCandidate(candidate({ missingData: ['volatility', 'liquidity confirmation'] }))
    const risky = rankOpportunityCandidate(candidate({ riskSummary: { riskLevel: 'high', score: 80 } }))
    const degraded = rankOpportunityCandidate(candidate(), { providerMetadata: { degraded: true, fallbackUsed: true }, evaluation: { warnings: ['fallback_used'] } })
    const rejected = rankOpportunityCandidate(candidate({ strategyQualification: 'disqualified' }))
    expect(stale.rankingScore).toBeLessThan(healthy.rankingScore)
    expect(missing.rankingScore).toBeLessThan(healthy.rankingScore)
    expect(risky.rankingScore).toBeLessThan(healthy.rankingScore)
    expect(degraded.rankingScore).toBeLessThan(healthy.rankingScore)
    expect(rejected.rankingStatus).toBe('rejected')
    expect(rejected.rankingTier).toBe('rejected')
  })

  it('rejects malformed ranking inputs and preserves deterministic tier boundaries', () => {
    expect(() => rankOpportunityCandidates('bad')).toThrow('opportunity ranking input is invalid')
    expect(rankOpportunityCandidate(candidate({ scannerScore: 100, riskSummary: { score: 0 }, missingData: [] })).rankingTier).toMatch(/priority_review|review/)
    expect(rankOpportunityCandidate(candidate({ scannerScore: 10, missingData: ['market data'], riskSummary: { score: 70 } })).rankingTier).toMatch(/limited|rejected/)
  })
})

describe('Phase 87B explainability and evidence', () => {
  it('separates observed data from interpretation and propagates positive, negative, stale, missing, and evaluation evidence', () => {
    const ranked = rankOpportunityCandidate(candidate({ stale: true, missingData: ['volume'] }), {
      aiSummary: { reasoning: 'Interpretation remains bounded.', risks: ['stale context'], limitations: ['No price target.'] },
      evaluation: { overallStatus: 'warning', warnings: ['unsupported_claim_risk'] },
      providerMetadata: { fallbackUsed: true },
    })
    expect(ranked.explainability.observedEvidence.join(' ')).toContain('Scanner score')
    expect(ranked.explainability.modelInterpretation).toContain('Interpretation remains bounded')
    expect(ranked.explainability.positiveContributors.length).toBeGreaterThan(0)
    expect(ranked.explainability.negativeContributors.length).toBeGreaterThan(0)
    expect(ranked.explainability.staleOrMissingData.join(' ')).toContain('volume')
    expect(ranked.explainability.evaluationWarnings).toContain('unsupported_claim_risk')
    expect(ranked.explainability.rawProviderPayloadStored).toBe(false)
    expect(ranked.explainability.chainOfThoughtStored).toBe(false)
    expect(JSON.stringify(ranked.explainability)).not.toMatch(/guaranteed|risk-free/i)
  })

  it('builds compact audit-safe explanations without raw provider payloads', () => {
    const explanation = buildOpportunityExplainability({
      candidate: candidate(),
      eligibility: { eligible: true, reasonCodes: [] },
      ranking: rankOpportunityCandidate(candidate()),
      aiSummary: { reasoning: '<b>bounded interpretation</b>' },
    })
    expect(explanation.rawProviderPayloadStored).toBe(false)
    expect(explanation.chainOfThoughtStored).toBe(false)
    expect(JSON.stringify(explanation)).not.toContain('<b>')
  })
})

describe('Phase 87C-D review workflow and history API', () => {
  it('validates review state, feedback, bounded sanitized notes, history filters, and date ranges', () => {
    const review = validateOpportunityReviewUpdate({ opportunityId: 'opp-aapl', reviewState: 'saved', feedback: 'useful', reviewNote: '<b>useful for later review</b>' })
    expect(review.reviewState).toBe('saved')
    expect(review.reviewNote).not.toContain('<b>')
    expect(() => validateOpportunityReviewUpdate({ opportunityId: 'opp-aapl', reviewState: 'queued' })).toThrow('opportunity review state is invalid')
    expect(validateOpportunityHistoryFilters({ symbol: 'AAPL', category: 'opportunity_ranking', timeframe: 'swing', reviewState: 'saved', rankingTier: 'review', limit: 10 }).limit).toBe(10)
    expect(() => validateOpportunityHistoryFilters({ limit: 200 })).toThrow('opportunity history limit is invalid')
    expect(() => validateOpportunityHistoryFilters({ from: '2026-07-21', to: '2026-07-20' })).toThrow('opportunity history date range is invalid')
  })

  it('handles authenticated review updates, unauthorized rejection, and review-only metadata without trade creation', async () => {
    const repository = {
      updateOpportunityReviewState: vi.fn(async (input) => ({ ok: true, review: { ...input, tradeCreated: false, orderCreated: false, brokerExecution: false } })),
    }
    const handler = createAtlasAiOpportunitiesHandler({ atlasAiRepository: repository, organizationMembershipRepository: membership('analyst'), accountId: 'paper-portfolio' })
    const response = parse(await handler(authEvent({ action: 'review', opportunityId: 'opp-aapl', reviewState: 'saved', reviewNote: 'useful evidence' })))
    expect(response.statusCode).toBe(200)
    expect(repository.updateOpportunityReviewState).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'paper-portfolio', userId: tenantContext.userId }))
    expect(response.json.data.tradeCreated).toBe(false)
    expect(response.json.data.orderCreated).toBe(false)
    expect(parse(await handler(authEvent({ action: 'review', opportunityId: 'opp-aapl', reviewState: 'queued' }))).statusCode).toBe(400)

    const denied = createAtlasAiOpportunitiesHandler({ atlasAiRepository: repository, organizationMembershipRepository: membership('viewer'), accountId: 'paper-portfolio' })
    expect(parse(await denied(authEvent({ action: 'review', opportunityId: 'opp-aapl', reviewState: 'saved' }, 'viewer'))).statusCode).toBe(403)
  })

  it('enforces tenant-safe bounded history retrieval and filter validation without raw provider payloads', async () => {
    const repository = {
      listOpportunityAnalysisHistory: vi.fn(async () => [{
        id: 'hist-1',
        symbol: 'AAPL',
        analysisCategory: 'opportunity_ranking',
        timeframe: 'swing',
        reviewState: 'saved',
        rankingTier: 'review',
        payload: { rawProviderPayloadStored: false, chainOfThoughtStored: false },
      }]),
    }
    const handler = createAtlasAiOpportunitiesHandler({ atlasAiRepository: repository, organizationMembershipRepository: membership('analyst'), accountId: 'paper-portfolio' })
    const response = parse(await handler(authEvent({ action: 'history', filters: { symbol: 'AAPL', category: 'opportunity_ranking', timeframe: 'swing', reviewState: 'saved', limit: 5 } })))
    expect(response.statusCode).toBe(200)
    expect(response.json.data.pagination.limit).toBe(5)
    expect(repository.listOpportunityAnalysisHistory).toHaveBeenCalledWith(expect.objectContaining({ tenantContext: expect.objectContaining({ organizationId: 'org-atlas-local' }), accountId: 'paper-portfolio', userId: tenantContext.userId }))
    expect(JSON.stringify(response.json)).not.toMatch(/raw prompt|raw provider|chain-of-thought/i)
    expect(parse(await handler(authEvent({ action: 'history', filters: { symbol: 'BAD SYMBOL' } }))).statusCode).toBe(400)

    const crossTenant = createAtlasAiOpportunitiesHandler({ atlasAiRepository: repository, organizationMembershipRepository: membership('analyst', 'org-other'), accountId: 'paper-portfolio' })
    expect(parse(await crossTenant(authEvent({ action: 'history', filters: { limit: 5 } }))).statusCode).toBe(403)
  })

  it('persists compact ranking, explainability, expired versus dismissed states, and preserves audit history', async () => {
    const repository = createAtlasAiRepository({ database: { connected: false } })
    const saved = await repository.createOpportunityAnalysisHistory({
      tenantScope: tenantContext,
      accountId: 'paper-portfolio',
      userId: tenantContext.userId,
      sessionId: 'session-87',
      requestCategory: 'opportunity_ranking',
      atlasAiResponse: {
        analysisCategory: 'opportunity_ranking',
        timeframe: 'swing',
        rankedOpportunities: [{ opportunityId: 'opp-aapl', symbol: 'AAPL', rankingScore: 72, rankingTier: 'review', confidence: 0.7, explainability: { observedEvidence: ['scanner'] } }],
      },
    })
    expect(saved.history.rankingTier).toBe('review')
    expect(saved.history.reviewState).toBe('new')
    const dismissed = await repository.updateOpportunityReviewState({ tenantContext, accountId: 'paper-portfolio', userId: tenantContext.userId, opportunityId: 'opp-aapl', reviewState: 'dismissed' })
    const expired = await repository.updateOpportunityReviewState({ tenantContext, accountId: 'paper-portfolio', userId: tenantContext.userId, opportunityId: 'opp-aapl', reviewState: 'expired' })
    expect(dismissed.review.reviewState).toBe('dismissed')
    expect(expired.review.reviewState).toBe('expired')
    expect(dismissed.review.orderCreated).toBe(false)
  })
})

describe('Phase 87E opportunity UI integration', () => {
  it('renders ranked opportunities, explainability controls, notices, stale/degraded indicators, and no trade execution controls', () => {
    const markup = renderToStaticMarkup(React.createElement(AtlasOpportunityReviewPanel, {
      scannerSummaries: { candidates: [candidate({ stale: true })] },
      marketDataHealth: { marketDataScannerHealthStatus: 'degraded', marketDataScannerHealthSummary: { staleSymbols: 1 } },
      MetricCard,
      formatNumber: (value) => String(value),
    }))
    expect(markup).toContain('Opportunity Review')
    expect(markup).toContain('Advisory analysis only')
    expect(markup).toContain('Paper trading only')
    expect(markup).toContain('Explain')
    expect(markup).toContain('Save')
    expect(markup).toContain('Dismiss')
    expect(markup).toContain('degraded')
    expect(markup).toContain('expired')
    expect(markup).not.toMatch(/buy now|execute|guaranteed|risk-free|certain profit|broker/i)
  })
})

describe('Phase 87 migration and safety regressions', () => {
  it('adds only idempotent non-destructive migration support for history filters and review metadata', () => {
    const sql = buildMigrationSql()
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS review_state')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS ranking_tier')
    expect(sql).toContain('idx_atlas_ai_opportunity_history_filters')
    expect(sql).not.toMatch(/DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM/i)
  })

  it('confirms Phase 87 adds no order, broker, execution, or live-trading mutation path', () => {
    const ranked = rankOpportunityCandidate(candidate())
    expect(ranked.advisoryOnlyNotice).toContain('Advisory analysis only')
    expect(ranked.paperTradingOnlyNotice).toContain('Paper trading only')
    expect(ranked.actionable).toBe(false)
    expect(ranked).not.toHaveProperty('orderId')
    expect(ranked).not.toHaveProperty('brokerOrder')
    expect(ranked).not.toHaveProperty('positionMutation')
  })
})
