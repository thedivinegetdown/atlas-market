import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import App from './App'

describe('App', () => {
  it('renders the portfolio risk dashboard', () => {
    const markup = renderToStaticMarkup(<App />)

    expect(markup).toContain('Portfolio Risk Intelligence')
    expect(markup).toContain('Paper Trading only')
    expect(markup).toContain('portfolio.risk.evaluated')
    expect(markup).toContain('Trade Guardrails')
    expect(markup).toContain('trade.guardrail.evaluated')
    expect(markup).toContain('approved')
    expect(markup).toContain('rejected')
    expect(markup).toContain('Execution Simulation')
    expect(markup).toContain('trade.execution.simulated')
    expect(markup).toContain('Fill Price')
    expect(markup).toContain('Fees')
    expect(markup).toContain('Paper Accounting')
    expect(markup).toContain('portfolio.accounting.updated')
    expect(markup).toContain('Realized P&amp;L')
  })
})
