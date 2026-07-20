import { describe, expect, it } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import App from '../src/App.jsx'
import {
  FeatureLoadErrorFallback,
  FeaturePanelFallback,
} from '../src/components/LazyFeatureBoundary.jsx'
import {
  DESIGNATED_HEAVY_FEATURE_IMPORTS,
  evaluatePerformanceBudget,
  findStaticHeavyFeatureImports,
  parseHtmlJavaScriptReferences,
} from '../scripts/check-build-performance.mjs'

describe('Phase 89 bundle splitting and lazy feature loading', () => {
  it('uses dynamic imports for designated heavy dashboard features', () => {
    const source = readFileSync('src/App.jsx', 'utf8')
    expect(findStaticHeavyFeatureImports(source)).toEqual([])
    for (const specifier of DESIGNATED_HEAVY_FEATURE_IMPORTS) {
      expect(source).toContain(`import('${specifier}')`)
    }
    expect(source.match(/const AtlasCopilotPanel = lazy/g)).toHaveLength(1)
    expect(source.match(/const AtlasOpportunityReviewPanel = lazy/g)).toHaveLength(1)
    expect(source.match(/const AtlasPortfolioIntelligencePanel = lazy/g)).toHaveLength(1)
    expect(source.match(/const ReleaseDiagnosticsPanel = lazy/g)).toHaveLength(1)
  })

  it('renders the initial shell with accessible deferred-feature fallbacks', () => {
    const markup = renderToStaticMarkup(React.createElement(App))
    expect(markup).toContain('Portfolio Risk Intelligence')
    expect(markup).toContain('Atlas Copilot')
    expect(markup).toContain('Opportunity Review')
    expect(markup).toContain('Portfolio Intelligence')
    expect(markup).toContain('Release Diagnostics')
    expect(markup).toContain('role="status"')
    expect(markup).toContain('Loading deferred dashboard feature')
    expect(markup).not.toContain('Submit Atlas Copilot question')
    expect(markup).not.toContain('Ranked advisory opportunities')
    expect(markup).not.toContain('Portfolio intelligence cannot place orders or call brokers')
  })

  it('keeps loading and failure states safe, accessible, and bounded', () => {
    const loading = renderToStaticMarkup(React.createElement(FeaturePanelFallback, { label: 'Atlas Copilot' }))
    const failed = renderToStaticMarkup(React.createElement(FeatureLoadErrorFallback, { featureName: 'Atlas Copilot', retryCount: 2 }))
    expect(loading).toContain('aria-label="Atlas Copilot loading"')
    expect(loading).toContain('role="status"')
    expect(failed).toContain('aria-label="Atlas Copilot failed to load"')
    expect(failed).toContain('Feature panel could not be loaded safely')
    expect(failed).toContain('Retry')
    expect(failed).toContain('disabled=""')
    expect(failed).not.toMatch(/stack|at\s+\w+\s+\(|src\/components|raw html/i)
  })

  it('resolves lazy feature modules through the same component paths', async () => {
    const [copilot, opportunities, portfolio, release] = await Promise.all([
      import('../src/components/AtlasCopilotPanel.jsx'),
      import('../src/components/AtlasOpportunityReviewPanel.jsx'),
      import('../src/components/AtlasPortfolioIntelligencePanel.jsx'),
      import('../src/components/ReleaseDiagnosticsPanel.jsx'),
    ])
    expect(typeof copilot.AtlasCopilotPanel).toBe('function')
    expect(typeof opportunities.AtlasOpportunityReviewPanel).toBe('function')
    expect(typeof portfolio.AtlasPortfolioIntelligencePanel).toBe('function')
    expect(typeof release.ReleaseDiagnosticsPanel).toBe('function')
  })
})

describe('Phase 89 performance budget utility', () => {
  it('parses eager JavaScript references from Vite HTML', () => {
    const refs = parseHtmlJavaScriptReferences('<link rel="modulepreload" href="/assets/react-vendor-a.js"><script type="module" src="/assets/index-b.js"></script>')
    expect(refs).toEqual(['react-vendor-a.js', 'index-b.js'])
  })

  it('passes realistic eager budgets while allowing deferred feature chunks', () => {
    const metrics = {
      initialEntryChunk: { name: 'index-ok.js', bytes: 420 * 1024 },
      largestEagerChunk: { name: 'index-ok.js', bytes: 420 * 1024 },
      totalEagerJavaScriptBytes: 1400 * 1024,
      deferredChunks: [
        { name: 'atlas-ai-panels-lazy.js', bytes: 220 * 1024 },
        { name: 'release-diagnostics-ui-lazy.js', bytes: 120 * 1024 },
      ],
    }
    const result = evaluatePerformanceBudget(metrics, "const AtlasCopilotPanel = lazy(() => import('./components/AtlasCopilotPanel.jsx'))")
    expect(result.ok).toBe(true)
    expect(result.failures).toEqual([])
  })

  it('fails on eager oversize chunks, missing lazy chunks, and static heavy imports', () => {
    const metrics = {
      initialEntryChunk: { name: 'index-large.js', bytes: 700 * 1024 },
      largestEagerChunk: { name: 'index-large.js', bytes: 700 * 1024 },
      totalEagerJavaScriptBytes: 2200 * 1024,
      deferredChunks: [],
    }
    const source = "import { AtlasCopilotPanel } from './components/AtlasCopilotPanel.jsx'"
    const result = evaluatePerformanceBudget(metrics, source)
    expect(result.ok).toBe(false)
    expect(result.failures.join(' ')).toContain('Initial entry chunk exceeds')
    expect(result.failures.join(' ')).toContain('Expected deferred feature chunk atlas-ai-panels')
    expect(result.failures.join(' ')).toContain('eagerly imported')
  })

  it('confirms generated build output is ignored rather than committed by design', () => {
    const gitignore = readFileSync('.gitignore', 'utf8')
    expect(gitignore).toMatch(/^dist$/m)
  })
})
