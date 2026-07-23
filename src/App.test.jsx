import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import App from './App'

describe('App', () => {
  it('renders the professional multi-page workspace shell', () => {
    const markup = renderToStaticMarkup(<App />)

    expect(markup).toContain('Atlas Market')
    expect(markup).toContain('Trading OS')
    expect(markup).toContain('Dashboard')
    expect(markup).toContain('Markets')
    expect(markup).toContain('Scanner')
    expect(markup).toContain('Portfolio')
    expect(markup).toContain('Risk')
    expect(markup).toContain('Orders (Paper)')
    expect(markup).toContain('Strategies')
    expect(markup).toContain('Backtesting')
    expect(markup).toContain('Research')
    expect(markup).toContain('Atlas Copilot')
    expect(markup).toContain('Reports')
    expect(markup).toContain('System Health')
    expect(markup).toContain('Settings')
    expect(markup).toContain('Paper Trading only')
    expect(markup).toContain('Executive overview')
    expect(markup).toContain('Loading deferred dashboard feature')
  })
})
