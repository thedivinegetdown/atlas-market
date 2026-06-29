import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import App from './App'

describe('App', () => {
  it('renders the trading workspace heading', () => {
    const markup = renderToStaticMarkup(<App />)

    expect(markup).toContain('Institutional Trading Workspace')
  })
})
