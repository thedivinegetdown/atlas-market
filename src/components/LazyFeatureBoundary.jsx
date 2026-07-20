import { Component, Suspense } from 'react'

export function FeaturePanelFallback({ label = 'Dashboard feature' }) {
  return (
    <article className="panel feature-loading-panel" aria-label={`${label} loading`}>
      <div className="panel-heading">
        <h2>{label}</h2>
        <span role="status" aria-live="polite">Loading deferred dashboard feature.</span>
      </div>
      <p className="empty-state">Preparing advisory paper-trading context.</p>
    </article>
  )
}

export function FeatureLoadErrorFallback({ featureName = 'Dashboard feature', onRetry, retryCount = 0 }) {
  const retryDisabled = retryCount >= 2
  return (
    <article className="panel feature-error-panel" aria-label={`${featureName} failed to load`}>
      <div className="panel-heading">
        <h2>{featureName}</h2>
        <span>Feature panel could not be loaded safely.</span>
      </div>
      <p className="empty-state">Reload this panel or continue using the rest of Atlas Market.</p>
      <button type="button" onClick={onRetry} disabled={retryDisabled}>
        Retry
      </button>
    </article>
  )
}

export class FeatureLoadErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, retryCount: 0 }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  retry = () => {
    this.setState((state) => ({
      hasError: false,
      retryCount: Math.min(2, state.retryCount + 1),
    }))
  }

  render() {
    if (this.state.hasError) {
      return (
        <FeatureLoadErrorFallback
          featureName={this.props.featureName}
          onRetry={this.retry}
          retryCount={this.state.retryCount}
        />
      )
    }

    return this.props.children
  }
}

export function LazyFeature({ label, children }) {
  return (
    <FeatureLoadErrorBoundary featureName={label}>
      <Suspense fallback={<FeaturePanelFallback label={label} />}>
        {children}
      </Suspense>
    </FeatureLoadErrorBoundary>
  )
}
