import { useMemo, useRef, useState } from 'react'
import { ATLAS_AI_NOTICE, buildAtlasAiContext, createAtlasAiGateway } from '../../lib/ai/atlasAiGateway.js'

const suggestions = [
  ['portfolio_summary', 'Summarize my current paper portfolio.'],
  ['trade_explanation', 'Explain why this paper trade was entered.'],
  ['session_recap', 'Summarize today paper-trading session.'],
  ['risk_summary', 'Explain my current portfolio risk.'],
  ['journal_analysis', 'Summarize patterns across recent journal entries.'],
  ['strategy_comparison', 'Compare two paper strategies.'],
]

export function AtlasCopilotPanel({
  tenantContext,
  accountId,
  portfolioSummary,
  pnlSummary,
  riskMetrics,
  strategyMetrics,
  scannerSummaries,
  signalSummaries,
  journalEntries,
  alerts,
  incidents,
  marketDataHealth,
  operationsHealth,
  MetricCard,
}) {
  const [question, setQuestion] = useState('Summarize my current paper portfolio.')
  const [requestCategory, setRequestCategory] = useState('portfolio_summary')
  const [status, setStatus] = useState('idle')
  const [history, setHistory] = useState([])
  const [streamingText, setStreamingText] = useState('')
  const [streamError, setStreamError] = useState('')
  const abortRef = useRef(null)
  const contextSources = useMemo(() => ({
    portfolioSummary,
    pnlSummary,
    riskMetrics,
    strategyMetrics,
    scannerSummaries,
    signalSummaries,
    journalEntries,
    alerts,
    incidents,
    marketDataHealth,
    operationsHealth,
  }), [alerts, incidents, journalEntries, marketDataHealth, operationsHealth, pnlSummary, portfolioSummary, riskMetrics, scannerSummaries, signalSummaries, strategyMetrics])
  const preview = useMemo(() => buildAtlasAiContext({ requestCategory, contextSources }), [contextSources, requestCategory])
  async function submit(event) {
    event.preventDefault()
    setStatus('loading')
    setStreamingText('')
    setStreamError('')
    abortRef.current = new AbortController()
    try {
      let completed
      for await (const streamEvent of createAtlasAiGateway().stream({
        tenantContext: { ...tenantContext, role: tenantContext?.role ?? 'viewer' },
        accountId,
        requestCategory,
        question,
        contextSources,
        conversation: history,
      }, { signal: abortRef.current.signal })) {
        if (streamEvent.streamEventType === 'chunk') {
          setStreamingText((current) => `${current}${streamEvent.chunk ?? ''}`)
          setStatus('loading')
        }
        if (streamEvent.streamEventType === 'completed') {
          completed = streamEvent.metadata
        }
        if (streamEvent.streamEventType === 'cancelled') {
          setStatus('cancelled')
          return
        }
        if (streamEvent.streamEventType === 'error') {
          setStreamError(streamEvent.error ?? 'Atlas Copilot stream failed.')
          setStatus('error')
          return
        }
      }
      const result = {
        atlasAiResponse: completed?.response,
        atlasAiRequest: completed?.atlasAiRequest,
        providerHealth: completed?.providerHealth,
      }
      setHistory((current) => [{ question, summary: result.atlasAiResponse.summary, result }, ...current].slice(0, 5))
      setStatus('completed')
    } catch (error) {
      setHistory((current) => [{ question, summary: error?.publicMessage ?? 'Atlas Copilot request could not be completed.', error: true }].concat(current).slice(0, 5))
      setStatus('error')
    }
  }

  function cancelStream() {
    abortRef.current?.abort()
    setStatus('cancelled')
  }

  function resetSession() {
    abortRef.current?.abort()
    setHistory([])
    setStreamingText('')
    setStreamError('')
    setStatus('idle')
  }

  const latest = history[0]?.result?.atlasAiResponse
  const response = latest ?? {
    summary: streamingText || 'Atlas Copilot is ready to analyze bounded paper-trading context.',
    observations: ['Choose a supported prompt and submit for advisory analysis.'],
    risks: ['AI output is not authoritative and cannot execute trades.'],
    recommendations: ['Use deterministic Atlas metrics for trading controls.'],
    confidence: 0.5,
    limitations: ['Provider output is mocked in local development.'],
    contextCategories: preview.contextCategories,
  }

  return (
    <article id="atlas-copilot" className={`panel atlas-copilot-panel ${status}`} aria-label="Atlas Copilot Read-Only AI Analysis">
      <div className="panel-heading">
        <h2>Atlas Copilot</h2>
        <span>Read-only AI analysis for paper-trading data. Advisory only, never execution.</span>
      </div>
      <p className="empty-state">{ATLAS_AI_NOTICE}</p>
      <form className="analytics-columns" onSubmit={submit}>
        <section>
          <label htmlFor="atlas-copilot-question">Question</label>
          <textarea
            id="atlas-copilot-question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            rows={4}
            maxLength={1200}
            aria-describedby="atlas-copilot-help"
          />
          <p id="atlas-copilot-help" className="empty-state">Ask about portfolio, risk, session, journal, trade, or strategy context. AI cannot place or modify trades.</p>
        </section>
        <section>
          <label htmlFor="atlas-copilot-category">Request category</label>
          <select id="atlas-copilot-category" value={requestCategory} onChange={(event) => setRequestCategory(event.target.value)}>
            {suggestions.map(([category, label]) => <option key={category} value={category}>{label}</option>)}
          </select>
          <label htmlFor="atlas-copilot-date-range">Date range</label>
          <select id="atlas-copilot-date-range" defaultValue="session">
            <option value="session">Current paper session</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
          </select>
          <label htmlFor="atlas-copilot-strategy">Strategy selector</label>
          <select id="atlas-copilot-strategy" defaultValue="all">
            <option value="all">All paper strategies</option>
            <option value="momentum">Momentum paper strategy</option>
            <option value="mean-reversion">Mean reversion paper strategy</option>
          </select>
        </section>
        <section>
          <button type="submit" aria-label="Submit Atlas Copilot question">Submit</button>
          <button type="button" onClick={cancelStream} aria-label="Cancel Atlas Copilot request">Cancel</button>
          <button type="button" onClick={resetSession} aria-label="Start new Atlas Copilot session">New session</button>
          <p role="status" aria-live="polite" className="empty-state">Copilot status: {status}. Provider mode: mock/degraded-safe.</p>
          {streamError ? <p role="alert" className="empty-state">{streamError}</p> : null}
        </section>
      </form>
      <div className="release-validation-summary">
        <MetricCard label="Context Categories" value={preview.contextCategories.length} />
        <MetricCard label="Confidence" value={`${Math.round((response.confidence ?? 0) * 100)}%`} />
        <MetricCard label="History Turns" value={history.length} />
        <MetricCard label="AI Health" value="enabled" />
      </div>
      <div className="release-readiness-list">
        <section>
          <h3>Summary</h3>
          <p className="empty-state">{status === 'loading' && streamingText ? streamingText : response.summary}</p>
        </section>
        <section>
          <h3>Observations</h3>
          <p className="empty-state">{(response.observations ?? []).join(' / ')}</p>
        </section>
        <section>
          <h3>Risks and Limitations</h3>
          <p className="empty-state">{[...(response.risks ?? []), ...(response.limitations ?? [])].join(' / ')}</p>
        </section>
        <section>
          <h3>Recommendations</h3>
          <p className="empty-state">{(response.recommendations ?? []).join(' / ')}</p>
        </section>
        <section>
          <h3>Context Used</h3>
          <p className="empty-state">{preview.contextCategories.join(' / ') || 'No context selected'} / fingerprint {preview.contextFingerprint}</p>
        </section>
        <section>
          <h3>Recent Copilot History</h3>
          <p className="empty-state">{history[0]?.summary ?? 'No prior bounded Copilot turns in this session.'}</p>
        </section>
      </div>
      <span className="event-line">atlasAi.requested</span>
      <span className="event-line">atlasAi.contextBuilt</span>
      <span className="event-line">atlasAi.completed</span>
      <span className="event-line">atlasAi.safetyBlocked</span>
    </article>
  )
}
