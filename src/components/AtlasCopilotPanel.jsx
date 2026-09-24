import { useRef, useState } from 'react'
import { workspaceApiClient } from '../api/workspaceApiClient.js'

export function GroundedEvidence({ response }) {
  return <>
    <section><h3>Deterministic Atlas Fact</h3>
      {(response?.facts ?? []).map((fact) => <section key={fact.id} aria-label={`${fact.id} evidence`}>
        <h4>{fact.id} · {fact.status}</h4>
        {fact.highlightedByModel ? <p>Model-selected evidence for review</p> : null}
        <p>{fact.classification} · {fact.source}</p>
        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{fact.status === 'UNAVAILABLE' ? `UNAVAILABLE: ${fact.reason}` : JSON.stringify(fact.value, null, 2)}</pre>
      </section>)}
    </section>
    <section><h3>Model Inferences</h3>{(response?.inferences ?? []).map((entry, index) => <p key={index}>{entry.text} Evidence: {entry.evidenceRefs.join(', ')}</p>)}</section>
  </>
}
export function AtlasCopilotPanel({ MetricCard }) {
  const [question, setQuestion] = useState('Summarize my current paper portfolio.')
  const [requestCategory, setRequestCategory] = useState('portfolio_summary')
  const [status, setStatus] = useState('idle')
  const [history, setHistory] = useState([])
  const [error, setError] = useState('')
  const generation = useRef(0)
  const response = history[0]?.atlasAiResponse
  async function submit(event) {
    event.preventDefault()
    const turn = ++generation.current
    setStatus('loading'); setError('')
    try {
      const result = await workspaceApiClient.askAtlasCopilot({ question, requestCategory })
      if (turn !== generation.current) return
      setHistory((previous) => [result, ...previous].slice(0, 5))
      setStatus(result.atlasAiRequest.status)
    } catch {
      if (turn !== generation.current) return
      setHistory([]); setError('Atlas Copilot is unavailable. Review the deterministic workspace evidence.'); setStatus('degraded')
    }
  }
  function cancel() { generation.current += 1; setStatus('cancelled') }
  function reset() { generation.current += 1; setHistory([]); setError(''); setStatus('idle') }
  return <article id="atlas-copilot" className={`panel atlas-copilot-panel ${status}`} aria-label="Atlas Copilot Read-Only AI Analysis">
    <div className="panel-heading"><h2>Atlas Copilot</h2><span>Read-only AI analysis for paper-trading data. Advisory only, never execution.</span></div>
    <p>Advisory analysis only. Paper trading only. Not financial advice.</p>
    <form onSubmit={submit}>
      <label htmlFor="atlas-copilot-question">Question</label>
      <textarea id="atlas-copilot-question" value={question} onChange={(event) => setQuestion(event.target.value)} rows={4} maxLength={2000} />
      <label htmlFor="atlas-copilot-category">Request category</label>
      <select id="atlas-copilot-category" value={requestCategory} onChange={(event) => setRequestCategory(event.target.value)}>
        {['portfolio_summary', 'trade_explanation', 'session_recap', 'risk_summary', 'journal_analysis', 'strategy_comparison'].map((category) => <option key={category} value={category}>{category.replaceAll('_', ' ')}</option>)}
      </select>
      <button type="submit" disabled={status === 'loading'} aria-label="Submit Atlas Copilot question">Submit</button>
      <button type="button" onClick={cancel} aria-label="Cancel Atlas Copilot request">Cancel display</button>
      <button type="button" onClick={reset} aria-label="Start new Atlas Copilot session">New session</button>
    </form>
    <p role="status">Copilot status: {status}. Provider: {response?.providerMetadata?.provider ?? 'UNAVAILABLE'} / Model: {response?.providerMetadata?.model ?? 'UNAVAILABLE'}.</p>
    {error ? <p role="alert">{error}</p> : null}
    <div className="release-validation-summary">
      <MetricCard label="Context Categories" value={response?.contextCategories?.length ?? 'UNAVAILABLE'} />
      <MetricCard label="Confidence" value="UNAVAILABLE" />
      <MetricCard label="History Turns" value={history.length} />
      <MetricCard label="AI Health" value={status} />
    </div>
    <h3>Summary</h3><p>{response?.summary ?? 'Submit a question to load authenticated server evidence.'}</p>
    <p>{response?.risks?.join(' / ')} {response?.limitations?.join(' / ')}</p>
    <GroundedEvidence response={response} />
    <h3>Context Used</h3><p>Fingerprint: {response?.contextFingerprint ?? 'UNAVAILABLE'} · Generated: {response?.generatedAt ?? 'UNAVAILABLE'}</p>
    <p>Latency: {response?.providerMetadata?.latencyMs ?? 'UNAVAILABLE'} ms · Cost: {response?.providerMetadata?.costUsd ?? 'UNAVAILABLE'} · {response?.providerMetadata?.costStatus}</p>
    <h3>Recent Copilot History</h3><p>{history.length} server responses in this session. Each request rebuilds its evidence.</p>
  </article>
}
