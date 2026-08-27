import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { StrategyRegistryPanel } from '../src/workspaces/Strategies/strategySections.jsx'

let root
let container

function render(element) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(element))
  return container
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
})

describe('governed strategy registry UI', () => {
  it('shows the implemented strategy and explicitly inactive placeholders without execution controls', () => {
    const view = render(<StrategyRegistryPanel />)
    expect(view.textContent).toContain('Index Pullback')
    expect(view.textContent).toContain('Breakout Momentum')
    expect(view.textContent).toContain('NOT IMPLEMENTED')
    expect(view.textContent).toContain('Registration does not implement')
    expect(view.querySelectorAll('button')).toHaveLength(0)
  })
})