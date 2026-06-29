import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import App from './App'

describe('App', () => {
  it('renders the main heading', () => {
    const markup = renderToStaticMarkup(<App />)

    expect(markup).toContain('Get started')
  })
})
