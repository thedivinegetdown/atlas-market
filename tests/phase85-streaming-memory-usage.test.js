import { describe, expect, it, vi } from 'vitest'
import {
  ATLAS_AI_STREAM_EVENTS,
  buildAtlasAiConversationMemory,
  createAtlasAiConversationMemoryStore,
  createAtlasAiGateway,
  createAtlasAiUsageLedger,
  createMockAtlasAiProvider,
  estimateAtlasAiCost,
} from '../lib/ai/atlasAiGateway.js'
import { createAtlasAiChatHandler } from '../netlify/functions/atlas-ai-chat.js'

const tenantContext = { organizationId: 'org-atlas-local', teamWorkspaceId: null, userId: 'local-development:user-1', role: 'owner' }
const contextSources = {
  portfolioSummary: { equity: 100000, cash: 25000 },
  riskMetrics: { riskLevel: 'medium', portfolioHeat: 0.35 },
}

function runInput(extra = {}) {
  return {
    tenantContext,
    accountId: 'paper-portfolio',
    sessionId: 'session-a',
    requestCategory: 'portfolio_summary',
    question: 'Summarize portfolio risk from Atlas context.',
    contextSources,
    ...extra,
  }
}

function authEvent(body = {}, role = 'owner') {
  return {
    httpMethod: 'POST',
    headers: {
      authorization: 'Bearer dev-token',
      'content-type': 'application/json',
      'x-csrf-token': 'csrf-ready',
      'x-atlas-dev-role': role,
      'x-atlas-dev-subject': 'user-1',
      'x-request-id': 'req-phase85-stream',
    },
    queryStringParameters: { organizationId: 'org-atlas-local', accountId: 'paper-portfolio' },
    body: JSON.stringify(body),
  }
}

describe('Phase 85A streaming response foundation', () => {
  it('emits ordered chunks and validates the final structured response before completion', async () => {
    const gateway = createAtlasAiGateway({ aiConfig: { streamChunkChars: 35 } })
    const events = []
    for await (const event of gateway.stream(runInput(), { correlationId: 'corr-1' })) events.push(event)
    const chunks = events.filter((event) => event.streamEventType === ATLAS_AI_STREAM_EVENTS.chunk)
    const completed = events.find((event) => event.streamEventType === ATLAS_AI_STREAM_EVENTS.completed)
    expect(events[0]).toMatchObject({ streamEventType: ATLAS_AI_STREAM_EVENTS.started, correlationId: 'corr-1', sessionId: 'session-a' })
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.map((event) => event.sequence)).toEqual(chunks.map((_, index) => index + 2))
    expect(completed.metadata.validated).toBe(true)
    expect(completed.metadata.atlasAiRequest.status).toBe('completed')
    expect(completed.metadata.atlasAiRequest.evaluation.overallStatus).toBe('passed')
    expect(JSON.stringify(events)).not.toContain('<script')
  })

  it('supports cancellation and never marks incomplete streams as persisted completed responses', async () => {
    const controller = new AbortController()
    const gateway = createAtlasAiGateway({ aiConfig: { streamChunkChars: 20 } })
    const events = []
    for await (const event of gateway.stream(runInput(), { signal: controller.signal })) {
      events.push(event)
      if (event.streamEventType === ATLAS_AI_STREAM_EVENTS.chunk) controller.abort()
    }
    expect(events.some((event) => event.streamEventType === ATLAS_AI_STREAM_EVENTS.cancelled)).toBe(true)
    expect(events.some((event) => event.streamEventType === ATLAS_AI_STREAM_EVENTS.completed)).toBe(false)
  })

  it('handles timeout and falls back automatically to non-streaming mode when provider streams are unavailable', async () => {
    const fallbackGateway = createAtlasAiGateway({ aiConfig: { streamChunkChars: 40 } })
    const fallbackEvents = []
    for await (const event of fallbackGateway.stream(runInput(), { correlationId: 'corr-fallback' })) fallbackEvents.push(event)
    expect(fallbackEvents[0].metadata.fallbackToNonStreaming).toBe(true)
    expect(fallbackEvents.some((event) => event.streamEventType === ATLAS_AI_STREAM_EVENTS.completed)).toBe(true)

    const timeoutGateway = createAtlasAiGateway({ providers: { mock: createMockAtlasAiProvider({ delayMs: 25 }) }, aiConfig: { streamTimeoutMs: 1, maxRetries: 0 } })
    const timeoutEvents = []
    for await (const event of timeoutGateway.stream(runInput(), { timeoutMs: 1 })) timeoutEvents.push(event)
    const error = timeoutEvents.find((event) => event.streamEventType === ATLAS_AI_STREAM_EVENTS.error)
    expect(error.error).toContain('timeout')
    expect(error.metadata.incompletePersistedAsCompleted).toBe(false)
  })

  it('does not persist incomplete streamed responses through the chat API', async () => {
    const repository = { createRequest: vi.fn(async () => ({ ok: true })), upsertHealth: vi.fn(async () => ({ ok: true })) }
    const atlasAiGateway = {
      async *stream() {
        yield { streamEventType: 'started', sequence: 1, metadata: {} }
        yield { streamEventType: 'chunk', sequence: 2, chunk: 'partial', metadata: {} }
        yield { streamEventType: 'cancelled', sequence: 3, cancelled: true, metadata: { incompletePersistedAsCompleted: false } }
      },
    }
    const handler = createAtlasAiChatHandler({
      atlasAiGateway,
      atlasAiRepository: repository,
      organizationMembershipRepository: { getMembership: vi.fn(async () => ({ id: 'membership-1', organizationId: 'org-atlas-local', userId: 'local-development:user-1', role: 'owner', status: 'active' })) },
      accountId: 'paper-portfolio',
    })
    const response = await handler(authEvent({ ...runInput(), stream: true }))
    const payload = JSON.parse(response.body)
    expect(response.statusCode).toBe(200)
    expect(payload.data.atlasAiStream.persisted).toBe(false)
    expect(payload.data.atlasAiStream.incompletePersistedAsCompleted).toBe(false)
    expect(repository.createRequest).not.toHaveBeenCalled()
  })
})

describe('Phase 85B bounded conversation memory', () => {
  it('summarizes older messages, enforces history limits, supports expiration and reset', () => {
    const conversation = Array.from({ length: 5 }, (_, index) => ({
      question: `question-${index}`,
      summary: `summary-${index}`,
      requestCategory: 'portfolio_summary',
      createdAt: `2026-07-1${index}T00:00:00.000Z`,
    }))
    const memory = buildAtlasAiConversationMemory({ ...runInput(), conversation, timestamp: '2026-07-20T00:00:00.000Z' }, { conversationHistoryLimit: 2, conversationRetentionDays: 3 })
    expect(memory.turns.map((turn) => turn.question)).toEqual(['question-3', 'question-4'])
    expect(memory.summarizedTurnCount).toBe(3)
    expect(memory.summary).toContain('question-0')
    expect(memory.providerPromptsStored).toBe(false)
    expect(memory.vectorStorageEnabled).toBe(false)

    const expired = buildAtlasAiConversationMemory({ ...runInput(), conversation, expiresAt: '2026-07-01T00:00:00.000Z', timestamp: '2026-07-20T00:00:00.000Z' }, { conversationHistoryLimit: 2 })
    expect(expired.expired).toBe(true)
    expect(expired.turns).toEqual([])

    const reset = buildAtlasAiConversationMemory({ ...runInput(), resetSession: true }, { conversationHistoryLimit: 2 })
    expect(reset.reset).toBe(true)
    expect(reset.turns).toEqual([])
  })

  it('keeps conversation memory isolated by tenant and user', () => {
    const store = createAtlasAiConversationMemoryStore({ clock: () => Date.parse('2026-07-20T00:00:00.000Z') })
    store.append(runInput(), { question: 'tenant one user one', summary: 'private summary', requestCategory: 'portfolio_summary' }, { conversationHistoryLimit: 4 })
    const otherUser = store.get(runInput({ tenantContext: { ...tenantContext, userId: 'local-development:user-2' } }), { conversationHistoryLimit: 4 })
    const otherTenant = store.get(runInput({ tenantContext: { ...tenantContext, organizationId: 'org-other' } }), { conversationHistoryLimit: 4 })
    const sameUser = store.get(runInput(), { conversationHistoryLimit: 4 })
    expect(sameUser.turns.length).toBe(1)
    expect(otherUser.turns.length).toBe(0)
    expect(otherTenant.turns.length).toBe(0)
  })
})

describe('Phase 85C usage and cost controls', () => {
  it('calculates estimated cost, records usage summaries, and carries retention metadata', async () => {
    const ledger = createAtlasAiUsageLedger({ clock: () => Date.parse('2026-07-20T12:00:00.000Z') })
    const cost = estimateAtlasAiCost({ inputTokens: 1000, outputTokens: 500 }, { costPer1kInputTokens: 0.01, costPer1kOutputTokens: 0.03 })
    expect(cost.estimatedCostUsd).toBe(0.025)
    const gateway = createAtlasAiGateway({
      usageLedger: ledger,
      aiConfig: { costPer1kInputTokens: 0.01, costPer1kOutputTokens: 0.03, usageRetentionDays: 45 },
    })
    const result = await gateway.run(runInput())
    expect(result.atlasAiRequest.usageControl.status).toBe('allowed')
    expect(result.atlasAiRequest.usageControl.authorizedSummary.daily.requestCount).toBe(1)
    expect(result.atlasAiRequest.usageControl.retention.usageRetentionDays).toBe(45)
    expect(result.atlasAiRequest.liveOrders).toBe(false)
    expect(result.atlasAiRequest.brokerExecution).toBe(false)
  })

  it('returns graceful degraded responses on budget exhaustion without affecting deterministic Atlas workflows', async () => {
    const provider = createMockAtlasAiProvider({ provider: 'mock', model: 'expensive-mock' })
    const gateway = createAtlasAiGateway({
      providers: { mock: provider },
      aiConfig: {
        dailyBudgetUsd: 0.000001,
        monthlyBudgetUsd: 0.000001,
        costPer1kInputTokens: 10,
        costPer1kOutputTokens: 10,
      },
    })
    const result = await gateway.run(runInput())
    expect(result.atlasAiRequest.status).toBe('degraded')
    expect(result.atlasAiRequest.usageControl.status).toBe('exhausted')
    expect(result.atlasAiRequest.usageControl.deterministicAtlasAffected).toBe(false)
    expect(result.atlasAiResponse.advisoryOnly).toBe(true)
    expect(result.atlasAiResponse.paperTradingOnly).toBe(true)
  })
})
