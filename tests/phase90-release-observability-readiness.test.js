import { describe, expect, it } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import {
  createObservabilityRecord,
  createReleaseMetadata,
  createRuntimeDiagnostics,
  evaluateLiveness,
  evaluateReadiness,
  normalizeErrorCategory,
  redactObservabilityValue,
} from '../lib/system/releaseObservabilityReadinessEngine.js'
import {
  createReleaseVerificationSummary,
  runReleaseVerification,
  scanMigrationSafety,
  verifyGeneratedArtifacts,
} from '../scripts/release-verify.mjs'
import { createReleaseRuntimeHealthHandler } from '../netlify/functions/release-runtime-health.js'
import { ReleaseDiagnosticsPanel } from '../src/components/ReleaseDiagnosticsPanel.jsx'

const tenantContext = { organizationId: 'org-atlas-local', teamWorkspaceId: null, userId: 'local-development:user-1', role: 'owner' }
const MetricCard = ({ label, value, tone }) => React.createElement('article', { className: `metric-card ${tone ?? ''}` }, React.createElement('span', null, label), React.createElement('strong', null, value))
const formatNumber = (value) => String(value)

function passingRunner() {
  return { status: 0, stdout: 'ok\n✖ 26 problems (0 errors, 26 warnings)', stderr: '' }
}

describe('Phase 90 runtime health and readiness', () => {
  it('returns healthy liveness without depending on optional providers', () => {
    const live = evaluateLiveness({ paperTradingOnly: true, runtimeAvailable: true, commit: 'abc123' }, { timestamp: '2026-07-21T09:00:00.000Z' })
    expect(live.status).toBe('healthy')
    expect(live.liveness).toBe(true)
    expect(live.readiness).toBe(false)
    expect(live.releaseMetadata.commit).toBe('abc123')
    expect(live.brokerExecution).toBe(false)
  })

  it('degrades readiness when optional AI is unavailable while deterministic Atlas remains available', () => {
    const readiness = evaluateReadiness({
      configurationValidation: { configurationValidationStatus: 'healthy', findings: [] },
      apiReliability: { apiReliabilityStatus: 'ready' },
      aiProviderAvailable: false,
      migrationCompatible: true,
      performanceBudgetStatus: 'healthy',
    }, { timestamp: '2026-07-21T09:00:00.000Z' })
    expect(readiness.status).toBe('degraded')
    expect(readiness.aiAssistanceAvailable).toBe(false)
    expect(readiness.deterministicAtlasAvailable).toBe(true)
    expect(readiness.checks.find((item) => item.id === 'ai-provider').failureCategory).toBe('ai_provider')
  })

  it('marks readiness unhealthy for required configuration failure with safe categories', () => {
    const readiness = evaluateReadiness({
      configurationValidation: { configurationValidationStatus: 'blocked', findings: [{ id: 'database-url-missing' }] },
      apiReliability: { apiReliabilityStatus: 'ready' },
      aiProviderAvailable: true,
      migrationCompatible: true,
      performanceBudgetStatus: 'healthy',
    })
    expect(readiness.status).toBe('unhealthy')
    expect(readiness.checks.find((item) => item.id === 'configuration').failureCategory).toBe('configuration')
    expect(JSON.stringify(readiness)).not.toMatch(/postgres:\/\/|Bearer|stack/i)
  })

  it('normalizes timeout and authorization categories deterministically', () => {
    expect(normalizeErrorCategory({ code: 'provider_timeout' })).toBe('timeout')
    expect(normalizeErrorCategory({ code: 'authorization_failed' })).toBe('authorization')
  })
})

describe('Phase 90 structured observability and redaction', () => {
  it('creates bounded structured records with safe labels and correlation metadata', () => {
    const record = createObservabilityRecord({
      eventType: 'release verification failed with user text',
      route: 'release-runtime-health',
      category: 'raw user category !!!',
      status: 'degraded',
      durationMs: 999999,
      correlationId: 'corr-1',
      requestId: 'req-1',
      tenantContext,
      metadata: { authorization: 'Bearer secret-token', prompt: 'raw prompt should not remain', privateUrl: 'http://localhost:8888/internal' },
    })
    expect(record.labels.route).toBe('release-runtime-health')
    expect(record.labels.category).toBe('raw_user_category____')
    expect(record.durationMs).toBe(300000)
    expect(record.correlationId).toBe('corr-1')
    expect(JSON.stringify(record)).not.toContain('secret-token')
    expect(JSON.stringify(record)).not.toContain('localhost')
  })

  it('redacts credentials, authorization headers, raw provider data, private URLs, and tenant-sensitive content', () => {
    const redacted = redactObservabilityValue({
      apiKey: 'sk-test-secret',
      authorization: 'Bearer abc123',
      rawProviderResponse: 'raw provider response',
      chainOfThought: 'hidden',
      userInput: 'https://internal.example.local/path?token=secret',
    })
    expect(JSON.stringify(redacted)).not.toMatch(/sk-test-secret|abc123|internal\.example|hidden/)
    expect(redacted.apiKey).toBe('[REDACTED]')
  })
})

describe('Phase 90 release verification command', () => {
  it('runs successful stages in order and enforces lint warning baseline', () => {
    const calls = []
    const summary = runReleaseVerification({
      runner: (command, args) => {
        calls.push([command, ...args].join(' '))
        return passingRunner()
      },
      readFile: () => '',
      root: 'Z:/missing-root',
      gitStatus: '',
      gitTrackedFiles: [],
      env: {},
    })
    expect(summary.ok).toBe(true)
    expect(summary.lintWarnings).toBe(26)
    expect(calls).toEqual([
      'npm test -- tests/phase80-security-accessibility-hardening.test.js tests/phase82-release-closure-merge-readiness.test.js',
      'npm test',
      'npm run lint',
      'npm run build',
      'npm run performance:check',
    ])
  })

  it('fails fast with clear failing-stage output and nonzero status', () => {
    const summary = runReleaseVerification({
      runner: (command, args) => ({ status: args.includes('lint') ? 1 : 0, stdout: 'lint failed', stderr: '' }),
      readFile: () => '',
      root: 'Z:/missing-root',
      env: {},
    })
    expect(summary.ok).toBe(false)
    expect(summary.failedStage).toBe('lint')
  })

  it('detects build warnings, performance failures, destructive migrations, artifacts, and dirty worktrees', () => {
    const summary = createReleaseVerificationSummary({
      stages: [{ stage: 'production-build', status: 'passed', exitCode: 0 }],
      gitStatus: ' M README.md',
      lintWarnings: 27,
      buildWarning: true,
      migrationSafety: scanMigrationSafety('DROP TABLE atlas_live_orders'),
      sensitiveScan: { ok: true, findings: [] },
      artifactCheck: verifyGeneratedArtifacts({ gitTrackedFiles: ['dist/assets/index.js'] }),
    })
    expect(summary.ok).toBe(false)
    expect(summary.failedStage).toBe('lint-warning-baseline')
    expect(summary.dirtyWorktree).toBe(true)
    expect(summary.migrationSafety.ok).toBe(false)
    expect(summary.artifactCheck.ok).toBe(false)
  })
})

describe('Phase 90 metadata, endpoint, and diagnostics UI', () => {
  it('returns safe release metadata without internal path or secret exposure', () => {
    const metadata = createReleaseMetadata({ commit: 'abc123', environmentName: 'production', frontendBundleVersion: 'bundle-1' }, { timestamp: '2026-07-21T09:00:00.000Z' })
    expect(metadata.applicationVersion).toBe('1.0.0')
    expect(metadata.apiCompatibilityVersion).toBe('atlas-api-v1')
    expect(metadata.internalPathsIncluded).toBe(false)
    expect(JSON.stringify(metadata)).not.toMatch(/F:\\|DATABASE_URL|sk-/)
  })

  it('serves compact sanitized runtime health from the Netlify handler', async () => {
    const response = await createReleaseRuntimeHealthHandler({ env: { NODE_ENV: 'test', TRADING_MODE: 'paper' }, databaseAvailable: true, aiProviderAvailable: false })({
      httpMethod: 'GET',
      headers: { 'x-request-id': 'req-phase90' },
      queryStringParameters: { mode: 'summary' },
    })
    const json = JSON.parse(response.body)
    expect(response.statusCode).toBe(200)
    expect(json.data.releaseRuntimeHealth.readiness.status).toBe('degraded')
    expect(JSON.stringify(json)).not.toMatch(/Bearer|postgres:\/\/|stack|raw provider/i)
  })

  it('renders authorized diagnostics states and bounded refresh without deploy or rollback controls', () => {
    const runtimeDiagnostics = createRuntimeDiagnostics({
      configurationValidation: { configurationValidationStatus: 'healthy', findings: [] },
      apiReliability: { apiReliabilityStatus: 'ready' },
      aiProviderAvailable: false,
      migrationCompatible: true,
      performanceBudgetStatus: 'healthy',
      releaseVerificationStatus: 'healthy',
      releaseMetadata: { commit: 'abc123' },
    })
    const markup = renderToStaticMarkup(React.createElement(ReleaseDiagnosticsPanel, {
      tenantContext,
      accountId: 'paper-portfolio',
      runtimeDiagnostics,
      releaseVerificationSummary: { ok: true },
      systems: [],
      MetricCard,
      formatNumber,
    }))
    expect(markup).toContain('Runtime Health and Readiness')
    expect(markup).toContain('Liveness Status')
    expect(markup).toContain('Readiness Status')
    expect(markup).toContain('degraded')
    expect(markup).toContain('aria-label="Refresh release diagnostics"')
    expect(markup).not.toMatch(/<button[^>]*(Deploy|Rollback|Restart|Submit order|broker action)/i)
  })

  it('renders unauthorized denial and preserves lazy feature registration', () => {
    const denied = renderToStaticMarkup(React.createElement(ReleaseDiagnosticsPanel, {
      tenantContext: { ...tenantContext, role: 'viewer' },
      accountId: 'paper-portfolio',
      authorized: false,
      systems: [],
      MetricCard,
      formatNumber,
    }))
    expect(denied).toContain('Release diagnostics access denied')
    const healthSectionsSource = readFileSync('src/workspaces/SystemHealth/healthSections.jsx', 'utf8')
    expect(healthSectionsSource).toContain("lazy(() => import('../../components/ReleaseDiagnosticsPanel.jsx')")
  })
})

