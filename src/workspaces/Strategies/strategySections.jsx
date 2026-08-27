import { EmptyWorkspaceState, MetricCard, WorkspacePanel } from '../../components/workspace/WorkspacePage.jsx'
import { useStrategySuitability } from '../../hooks/useStrategySuitability.js'
import { buildStrategyFamilyRegistry } from '../../../lib/strategies/registry/index.js'

function formatStatus(value) {
  return String(value ?? 'UNKNOWN').replaceAll('_', ' ')
}

export function StrategySuitabilityPanel({ symbol = 'SPY', state } = {}) {
  const liveState = useStrategySuitability({ symbol: state ? null : symbol })
  const resolved = state ?? liveState
  const suitability = resolved.suitability
  if (resolved.isLoading && !suitability) {
    return <WorkspacePanel id="adaptive-strategy-suitability" title="Adaptive Strategy Suitability" subtitle="Deterministic, read-only"><p role="status">Loading strategy suitability…</p></WorkspacePanel>
  }
  if (resolved.error && !suitability) {
    return <WorkspacePanel id="adaptive-strategy-suitability" title="Adaptive Strategy Suitability" subtitle="Deterministic, read-only"><p role="alert">Strategy suitability is unavailable.</p></WorkspacePanel>
  }
  if (!suitability) {
    return <WorkspacePanel id="adaptive-strategy-suitability" title="Adaptive Strategy Suitability" subtitle="Deterministic, read-only"><EmptyWorkspaceState>No strategy suitability evidence is available.</EmptyWorkspaceState></WorkspacePanel>
  }
  const strategies = suitability.strategies ?? []
  return (
    <WorkspacePanel id="adaptive-strategy-suitability" title="Adaptive Strategy Suitability" subtitle={`${symbol} · ${formatStatus(suitability.status)}`}>
      <div className="metric-grid">
        <MetricCard label="Trend Regime" value={formatStatus(suitability.regime?.trendRegime)} />
        <MetricCard label="Volatility Regime" value={formatStatus(suitability.regime?.volatilityRegime)} />
        <MetricCard label="Risk Regime" value={formatStatus(suitability.regime?.riskRegime)} />
        <MetricCard label="Regime Confidence" value={`${suitability.regime?.confidence ?? 0}%`} />
        <MetricCard label="Regime Status" value={formatStatus(suitability.regime?.status)} />
        <MetricCard label="Freshness" value={formatStatus(suitability.regime?.freshness)} />
        <MetricCard label="Enabled" value={suitability.summary?.enabled ?? 0} />
        <MetricCard label="Conditional" value={suitability.summary?.conditional ?? 0} />
        <MetricCard label="Disabled" value={suitability.summary?.disabled ?? 0} />
        <MetricCard label="Unknown" value={suitability.summary?.unknown ?? 0} />
      </div>
      {strategies.length === 0 ? <EmptyWorkspaceState>No existing strategies are registered for suitability evaluation.</EmptyWorkspaceState> : (
        <div className="strategy-manager-list">
          {strategies.map((strategy) => (
            <article className="strategy-manager-card" key={strategy.strategyId}>
              <div className="panel-heading">
                <h3>{strategy.strategyName}</h3>
                <span role="status">{formatStatus(strategy.decision)}</span>
              </div>
              <p>Confidence: {strategy.confidence}% · Lifecycle: {formatStatus(strategy.lifecycleState)}</p>
              {strategy.reasons?.length ? <ul>{strategy.reasons.slice(0, 4).map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}
              {strategy.blockingReasons?.length || strategy.missingInputs?.length ? (
                <details>
                  <summary>Evidence and safety details</summary>
                  {strategy.blockingReasons?.map((reason) => <p key={reason}>{reason}</p>)}
                  {strategy.missingInputs?.length ? <p>Missing: {strategy.missingInputs.join(', ')}</p> : null}
                </details>
              ) : null}
            </article>
          ))}
        </div>
      )}
      <p>Suitability only. Paper trading remains mandatory; selection cannot activate strategies or override risk controls.</p>
    </WorkspacePanel>
  )
}

export function StrategyRegistryPanel({ registry = buildStrategyFamilyRegistry() } = {}) {
  return <WorkspacePanel id="strategy-registry" title="Registry" subtitle="Governed strategy library">
    <div className="strategy-manager-list">
      {registry.strategies.map((strategy) => <article className="strategy-manager-card" key={strategy.strategyId}>
        <div className="panel-heading"><h3>{strategy.displayName}</h3><span role="status">{formatStatus(strategy.implementationStatus)}</span></div>
        <div className="metric-grid">
          <MetricCard label="Family" value={formatStatus(strategy.familyId)} />
          <MetricCard label="Version" value={strategy.version ?? 'Not implemented'} />
          <MetricCard label="Lifecycle" value={formatStatus(strategy.lifecycleStatus)} />
          <MetricCard label="Paper status" value={formatStatus(strategy.paperEligibility)} />
          <MetricCard label="Live status" value={formatStatus(strategy.liveEligibility)} />
        </div>
        <p>{strategy.reasons[0]}</p>
      </article>)}
    </div>
    <p>Registry discovery only. Registration does not implement, activate, approve, or execute a strategy.</p>
  </WorkspacePanel>
}

export function StrategySections() {
  return (
    <>
      <StrategySuitabilityPanel />
      <WorkspacePanel id="strategy-builder" title="Strategy Builder" subtitle="Blueprint presentation">
        <div className="metric-grid">
          <MetricCard label="Builder" value="available" />
          <MetricCard label="Rule Evaluation" value="advisory" />
          <MetricCard label="Signal Composer" value="paper context" />
        </div>
      </WorkspacePanel>
      <WorkspacePanel id="strategy-lifecycle" title="Lifecycle" subtitle="Human-reviewed lifecycle">
        <EmptyWorkspaceState>Strategy lifecycle changes remain presentation-only in this workspace.</EmptyWorkspaceState>
      </WorkspacePanel>
      <StrategyRegistryPanel />
    </>
  )
}
