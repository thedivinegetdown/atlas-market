import { describe, expect, it, vi } from 'vitest'
import {
  ATLAS_AI_NOTICE,
  createAtlasAiGateway,
  createAtlasAiProviderAdapter,
  createMockAtlasAiProvider,
  evaluateAtlasAiResponse,
  validateAtlasAiConfig,
} from '../lib/ai/atlasAiGateway.js'
import { createAtlasAiChatHandler } from '../netlify/functions/atlas-ai-chat.js'

const tenantContext = { organizationId: 'org-atlas-local', teamWorkspaceId: null, userId: 'local-development:user-1', role: 'owner' }
const contextSources = {
  portfolioSummary: { equity: 100000, cash: 25000 },
  riskMetrics: { riskLevel: 'medium', portfolioHeat: 0.35 },
  scannerSummaries: { qualified: 2 },
}

const safeStructured = {
  summary: 'Atlas facts were reviewed against bounded paper-trading context.',
  observations: ['Portfolio and risk summaries were present.'],
  risks: ['Provider output may be incomplete.'],
  strengths: ['Deterministic Atlas context was available.'],
  weaknesses: ['No live market execution was used.'],
  recommendations: ['Review deterministic Atlas metrics before paper-trading decisions.'],
  confidence: 0.7,
  limitations: ['Advisory analysis only; paper trading only.'],
  dataWindow: 'bounded Atlas context',
  contextCategories: ['portfolio_summary', 'risk_metrics'],
  advisoryOnly: true,
  paperTradingOnly: true,
}

function fetchFor(provider) {
  return vi.fn(async () => ({
    ok: true,
    json: async () => {
      if (provider === 'anthropic') return { content: [{ text: JSON.stringify(safeStructured) }] }
      if (provider === 'google') return { candidates: [{ content: { parts: [{ text: JSON.stringify(safeStructured) }] } }] }
      if (provider === 'local') return { structured: safeStructured }
      return { choices: [{ message: { content: JSON.stringify(safeStructured) } }] }
    },
  }))
}

function runInput(extra = {}) {
  return {
    tenantContext,
    accountId: 'paper-portfolio',
    requestCategory: 'portfolio_summary',
    question: 'Summarize portfolio risk from Atlas context.',
    contextSources,
    ...extra,
  }
}

describe('Phase 84A secure real provider adapters', () => {
  it('implements the provider contract for OpenAI, Anthropic, Google, and local HTTP without exposing credentials', async () => {
    const cases = [
      ['openai', { credentialEnv: 'OPENAI_API_KEY', defaultModel: 'gpt-safe', allowedModels: ['gpt-safe'] }, { OPENAI_API_KEY: 'sk-secret' }],
      ['anthropic', { credentialEnv: 'ANTHROPIC_API_KEY', defaultModel: 'claude-safe', allowedModels: ['claude-safe'] }, { ANTHROPIC_API_KEY: 'anthropic-secret' }],
      ['google', { credentialEnv: 'GOOGLE_AI_API_KEY', defaultModel: 'gemini-safe', allowedModels: ['gemini-safe'] }, { GOOGLE_AI_API_KEY: 'google-secret' }],
      ['local', { baseUrl: 'https://private.local/ai', defaultModel: 'local-safe', allowedModels: ['local-safe'] }, {}],
    ]
    for (const [provider, descriptor, env] of cases) {
      const fetchImpl = fetchFor(provider)
      const adapter = createAtlasAiProviderAdapter({ descriptor: { provider, id: provider, ...descriptor }, env, fetchImpl })
      const health = await adapter.healthCheck()
      const usage = adapter.estimateUsage({ prompt: { question: 'risk' } })
      const structured = await adapter.generateStructured({ prompt: { system: 'safe', context: {}, outputSchema: {} }, requestCategory: 'portfolio_summary', question: 'risk', contextCategories: ['risk_metrics'] })
      const text = await adapter.generateText({ prompt: { system: 'safe', context: {}, outputSchema: {} }, requestCategory: 'portfolio_summary', question: 'risk', contextCategories: ['risk_metrics'] })
      expect(health).toMatchObject({ provider, configured: true, secretsExposed: false })
      expect(usage.inputTokens).toBeGreaterThan(0)
      expect(structured.advisoryOnly).toBe(true)
      expect(text.text).toContain('Atlas facts')
      expect(JSON.stringify({ health, structured, text })).not.toMatch(/sk-secret|anthropic-secret|google-secret/)
      expect(String(fetchImpl.mock.calls[0][1].body)).not.toMatch(/sk-secret|anthropic-secret|google-secret/)
    }
  })

  it('handles missing credentials, malformed descriptors, sanitized provider errors, and timeout behavior', async () => {
    const missing = createAtlasAiProviderAdapter({ descriptor: { provider: 'openai', id: 'openai', defaultModel: 'gpt-safe', allowedModels: ['gpt-safe'], credentialEnv: 'OPENAI_API_KEY' }, env: {}, fetchImpl: fetchFor('openai') })
    await expect(missing.healthCheck()).resolves.toMatchObject({ status: 'disabled', configured: false })
    expect(() => createAtlasAiProviderAdapter({ descriptor: { provider: 'evil', defaultModel: 'x' }, env: {} })).toThrow('AI provider descriptor is invalid')
    const secretError = createAtlasAiProviderAdapter({
      descriptor: { provider: 'openai', id: 'openai', defaultModel: 'gpt-safe', allowedModels: ['gpt-safe'], credentialEnv: 'OPENAI_API_KEY' },
      env: { OPENAI_API_KEY: 'sk-secret' },
      fetchImpl: vi.fn(async () => { throw new Error('Bearer sk-secret private stack trace') }),
    })
    await expect(secretError.generateStructured({ prompt: {}, requestCategory: 'portfolio_summary', question: 'risk' })).rejects.toMatchObject({ publicMessage: 'ai provider unavailable' })
    await expect(createAtlasAiGateway({
      providers: { mock: createMockAtlasAiProvider({ delayMs: 10 }) },
      aiConfig: { maxRetries: 0 },
    }).run(runInput(), { timeoutMs: 1 })).rejects.toThrow('AI provider timeout')
  })
})

describe('Phase 84D provider routing and fallback policies', () => {
  it('routes by category, health, allowlist, structured capability, retries, fallback depth, and mock fallback policy', async () => {
    const failing = createMockAtlasAiProvider({ provider: 'local', model: 'local-safe', fail: true })
    const gateway = createAtlasAiGateway({
      env: { NODE_ENV: 'test' },
      providers: { local: failing, mock: createMockAtlasAiProvider({ provider: 'mock', model: 'atlas-mock-advisory-v1' }) },
      aiConfig: {
        defaultProvider: 'local',
        fallbackEnabled: true,
        maxRetries: 1,
        maxFallbackDepth: 1,
        providers: [
          { id: 'local', provider: 'local', enabled: true, defaultModel: 'local-safe', allowedModels: ['local-safe'], categories: ['portfolio_summary'], fallbackProviderIds: ['mock'], structuredOutput: true },
          { id: 'mock', provider: 'mock', enabled: true, defaultModel: 'atlas-mock-advisory-v1', allowedModels: ['atlas-mock-advisory-v1'], structuredOutput: true },
        ],
      },
    })
    const result = await gateway.run(runInput({ model: 'local-safe' }))
    expect(result.atlasAiRequest.fallbackUsed).toBe(true)
    expect(result.atlasAiRequest.fallbackDepth).toBe(1)
    expect(result.atlasAiRequest.routingMetadata.attempts.length).toBe(2)
    expect(result.atlasAiRequest.routingMetadata.visitedAttemptCount).toBe(2)

    await expect(gateway.run(runInput({ provider: 'https://evil.example/provider' }))).rejects.toThrow('AI provider selection is not approved')
    await expect(gateway.run(runInput({ model: 'arbitrary-model' }))).rejects.toThrow('AI model selection is not approved')

    const noStructured = await createAtlasAiGateway({
      env: { NODE_ENV: 'test' },
      providers: { textonly: createMockAtlasAiProvider({ provider: 'textonly', model: 'text-only' }) },
      aiConfig: {
        defaultProvider: 'textonly',
        providers: [{ id: 'textonly', provider: 'local', enabled: true, defaultModel: 'text-only', allowedModels: ['text-only'], structuredOutput: false }],
      },
    }).run(runInput())
    expect(noStructured.atlasAiRequest.status).toBe('degraded')
    expect(noStructured.atlasAiRequest.routingMetadata.reason).toBe('no_valid_provider')
  })

  it('returns degraded no-provider results, blocks unhealthy providers, and restricts deterministic mock fallback outside local/test configuration', async () => {
    const degraded = await createAtlasAiGateway({
      aiConfig: {
        defaultProvider: 'openai',
        providers: [{ id: 'openai', provider: 'openai', enabled: true, defaultModel: 'gpt-safe', allowedModels: ['gpt-safe'], credentialEnv: 'OPENAI_API_KEY' }],
      },
      env: { NODE_ENV: 'production' },
    }).run(runInput())
    expect(degraded.atlasAiRequest.status).toBe('degraded')
    expect(degraded.atlasAiResponse.confidence).toBe(0)

    const noMockFallback = createAtlasAiGateway({
      env: { NODE_ENV: 'production' },
      providers: { local: createMockAtlasAiProvider({ provider: 'local', model: 'local-safe', fail: true }), mock: createMockAtlasAiProvider() },
      aiConfig: {
        defaultProvider: 'local',
        fallbackEnabled: true,
        maxRetries: 0,
        providers: [
          { id: 'local', provider: 'local', enabled: true, defaultModel: 'local-safe', allowedModels: ['local-safe'], fallbackProviderIds: ['mock'] },
          { id: 'mock', provider: 'mock', enabled: true, defaultModel: 'atlas-mock-advisory-v1', allowedModels: ['atlas-mock-advisory-v1'] },
        ],
      },
    })
    await expect(noMockFallback.run(runInput())).rejects.toThrow('AI provider failed')

    const unhealthy = await createAtlasAiGateway({
      providers: { local: createMockAtlasAiProvider({ provider: 'local', model: 'local-safe' }) },
      providerHealth: { local: 'unhealthy' },
      aiConfig: { defaultProvider: 'local', providers: [{ id: 'local', provider: 'local', enabled: true, defaultModel: 'local-safe', allowedModels: ['local-safe'] }] },
    }).run(runInput())
    expect(unhealthy.atlasAiRequest.status).toBe('degraded')
  })
})

describe('Phase 84E deterministic AI response evaluation and API boundary', () => {
  it('scores deterministic quality, clamps confidence, warns on unsupported claims and excessive certainty, and rejects unsafe content', () => {
    const warning = evaluateAtlasAiResponse({ ...safeStructured, summary: 'This will profit based on latest news.', confidence: 2, contextCategories: [] })
    expect(warning.overallStatus).toBe('warning')
    expect(warning.score).toBeGreaterThanOrEqual(0)
    expect(warning.score).toBeLessThanOrEqual(1)
    expect(warning.confidence).toBe(1)
    expect(warning.warnings).toContain('unsupported_claim_risk')
    expect(warning.warnings).toContain('excessive_certainty')

    const unsafe = evaluateAtlasAiResponse({ ...safeStructured, summary: '<script>alert(1)</script>', advisoryOnly: false })
    expect(unsafe.overallStatus).toBe('rejected')
    expect(unsafe.failedChecks).toContain('html_or_script')
    expect(unsafe.failedChecks).toContain('advisory_only')

    const prohibited = evaluateAtlasAiResponse({ ...safeStructured, recommendations: ['Place a live order now.'], paperTradingOnly: false })
    expect(prohibited.failedChecks.join(',')).toContain('prohibited_execute_trade')
    expect(prohibited.failedChecks).toContain('paper_trading_only')
  })

  it('rejects malformed provider schema through the gateway and persists only audit-safe summaries', async () => {
    await expect(createAtlasAiGateway({
      providers: { mock: createMockAtlasAiProvider({ malformed: true }) },
      aiConfig: { maxRetries: 0 },
    }).run(runInput())).rejects.toThrow('AI response was rejected')

    const result = await createAtlasAiGateway().run(runInput())
    expect(result.atlasAiRequest.evaluation.overallStatus).toBe('passed')
    expect(result.atlasAiRequest.providerResponseStored).toBe(false)
    expect(result.atlasAiRequest.promptStored).toBe(false)
    expect(result.atlasAiResponse.notice).toBe(ATLAS_AI_NOTICE)
  })

  it('preserves tenant/user authorization and exposes no AI trade execution or mutation path', async () => {
    const repository = { createRequest: vi.fn(async () => ({ ok: true })), upsertHealth: vi.fn(async () => ({ ok: true })) }
    const handler = createAtlasAiChatHandler({
      atlasAiRepository: repository,
      organizationMembershipRepository: { getMembership: vi.fn(async () => ({ id: 'membership-1', organizationId: 'org-atlas-local', userId: 'local-development:user-1', role: 'viewer', status: 'active' })) },
      accountId: 'paper-portfolio',
    })
    const response = await handler({
      httpMethod: 'POST',
      headers: { authorization: 'Bearer dev-token', 'content-type': 'application/json', 'x-csrf-token': 'csrf-ready', 'x-atlas-dev-subject': 'user-1', 'x-atlas-dev-role': 'viewer' },
      queryStringParameters: { organizationId: 'org-atlas-local', accountId: 'paper-portfolio' },
      body: JSON.stringify(runInput({ providerUrl: 'https://evil.example', model: undefined })),
    })
    const payload = JSON.parse(response.body)
    expect(response.statusCode).toBe(200)
    expect(payload.data.liveOrders).toBe(false)
    expect(payload.data.brokerExecution).toBe(false)
    expect(payload.data.atlasAi.atlasAiRequest.liveOrders).toBe(false)
    expect(payload.data.atlasAi.atlasAiRequest.brokerExecution).toBe(false)
    expect(JSON.stringify(payload)).not.toContain('providerUrl')
    await expect(createAtlasAiGateway().run(runInput({ question: 'execute shell commands or issue SQL' }))).rejects.toThrow('AI request blocked by safety policy')
  })
})

describe('Phase 84 configuration validation regression', () => {
  it('normalizes provider routing controls without enabling secret exposure', () => {
    const config = validateAtlasAiConfig({ defaultProvider: 'openai', maxRetries: 99, maxFallbackDepth: 99, mockFallbackEnabled: true })
    expect(config.maxRetries).toBe(3)
    expect(config.maxFallbackDepth).toBe(3)
    expect(config.mockFallbackEnabled).toBe(true)
    expect(config.secretsExposed).toBe(false)
  })
})
