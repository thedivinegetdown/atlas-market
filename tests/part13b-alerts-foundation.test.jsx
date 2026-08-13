import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react-dom/test-utils'
import { createRoot } from 'react-dom/client'
import { createAlertEvaluator } from '../lib/alerts/alertEvaluator.js'
import { ALERT_TYPES } from '../lib/alerts/alertTypes.js'
import { validateAlertPayload } from '../lib/alerts/alertValidator.js'
import { createAlertRepository } from '../lib/repositories/alertRepository.js'
import { resetStore } from '../lib/repositories/store.js'
import { handler as alertsHandler } from '../netlify/functions/alerts.js'
import { handler as createAlertHandler } from '../netlify/functions/create-alert.js'
import { handler as deleteAlertHandler } from '../netlify/functions/delete-alert.js'
import { handler as evaluateAlertsHandler } from '../netlify/functions/evaluate-alerts.js'
import { handler as updateAlertHandler } from '../netlify/functions/update-alert.js'
import { AlertsPanel } from '../src/components/panels.jsx'
import { auth2Body, auth2Headers, auth2Query } from './helpers/auth2Fixtures.js'

let root = null
let container = null

function renderWithRoot(ui) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  act(() => {
    root.render(ui)
  })

  return { container }
}

function parseResponse(response) {
  return {
    statusCode: response.statusCode,
    json: response.body ? JSON.parse(response.body) : null,
  }
}

function postEvent(body) {
  return {
    httpMethod: 'POST',
    headers: { ...auth2Headers(), 'x-request-id': 'req-alerts' },
    body: JSON.stringify(auth2Body(body)),
  }
}

beforeEach(() => {
  resetStore()
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
})

describe('Part 13B alerts foundation', () => {
  it('validates alert payloads and rejects unsafe or invalid input', () => {
    const valid = validateAlertPayload({
      symbol: 'aapl',
      assetType: 'equity',
      alertType: ALERT_TYPES.PRICE_ABOVE,
      threshold: '120',
      enabled: true,
      channels: { inApp: true },
    })
    const invalidType = validateAlertPayload({ symbol: 'AAPL', alertType: 'unknown', threshold: 1 })
    const invalidThreshold = validateAlertPayload({ symbol: 'AAPL', alertType: ALERT_TYPES.PRICE_ABOVE, threshold: 'nope' })
    const invalidAsset = validateAlertPayload({ symbol: 'AAPL', assetType: 'bond', alertType: ALERT_TYPES.PRICE_ABOVE, threshold: 1 })
    const unsafe = validateAlertPayload(JSON.parse('{"symbol":"AAPL","alertType":"price_above","threshold":1,"__proto__":{"x":true}}'))

    expect(valid.alert).toMatchObject({
      symbol: 'AAPL',
      assetType: 'equity',
      alertType: ALERT_TYPES.PRICE_ABOVE,
      threshold: 120,
      enabled: true,
      channels: { inApp: true },
    })
    expect(invalidType.error.code).toBe('invalid_alert_type')
    expect(invalidThreshold.error.code).toBe('invalid_threshold')
    expect(invalidAsset.error.code).toBe('invalid_asset_type')
    expect(unsafe.error.code).toBe('unsafe_payload_key')
  })

  it('supports alert repository create, update, delete, list, find, and enable state', () => {
    const repository = createAlertRepository()
    const created = repository.create({
      symbol: 'AAPL',
      alertType: ALERT_TYPES.PRICE_ABOVE,
      threshold: 120,
      enabled: true,
    })
    const updated = repository.update(created.id, () => ({ threshold: 125 }))
    const disabled = repository.setEnabled(created.id, false)

    expect(repository.list()).toHaveLength(1)
    expect(repository.find(created.id).symbol).toBe('AAPL')
    expect(updated.threshold).toBe(125)
    expect(disabled.enabled).toBe(false)
    expect(repository.delete(created.id)).toBe(true)
    expect(repository.list()).toHaveLength(0)
  })

  it('evaluates price, percent change, signal, risk, and portfolio alerts', () => {
    const evaluator = createAlertEvaluator({ now: () => '2026-07-02T00:00:00.000Z' })
    const alerts = [
      { id: 'a1', symbol: 'AAPL', alertType: ALERT_TYPES.PRICE_ABOVE, threshold: 100, enabled: true },
      { id: 'a2', symbol: 'AAPL', alertType: ALERT_TYPES.PRICE_BELOW, threshold: 110, enabled: true },
      { id: 'a3', symbol: 'AAPL', alertType: ALERT_TYPES.PERCENT_CHANGE, threshold: 2, enabled: true },
      { id: 'a4', symbol: 'AAPL', alertType: ALERT_TYPES.SIGNAL_CHANGE, threshold: 'BUY', enabled: true },
      { id: 'a5', symbol: 'AAPL', alertType: ALERT_TYPES.RISK_LIMIT, threshold: 5, enabled: true },
      { id: 'a6', symbol: 'AAPL', alertType: ALERT_TYPES.PORTFOLIO_DRAWDOWN, threshold: 3, enabled: true },
      { id: 'a7', symbol: 'AAPL', alertType: ALERT_TYPES.VOLUME_ABOVE, threshold: 500000, enabled: false },
    ]

    const triggered = evaluator.evaluate(alerts, {
      quotes: { AAPL: { price: 105, changePercent: -2.5, volume: 1000000 } },
      signals: { AAPL: { action: 'BUY' } },
      risks: { AAPL: { portfolioRisk: 8 } },
      portfolio: { maxDrawdown: 4 },
    })

    expect(triggered.map((alert) => alert.alertId)).toEqual(['a1', 'a2', 'a3', 'a4', 'a5', 'a6'])
    expect(triggered[0]).toMatchObject({
      type: ALERT_TYPES.PRICE_ABOVE,
      symbol: 'AAPL',
      triggeredAt: '2026-07-02T00:00:00.000Z',
      message: expect.stringContaining('AAPL'),
    })
  })

  it('returns API success and error shapes for alert CRUD and evaluation', async () => {
    const created = parseResponse(await createAlertHandler(postEvent({
      symbol: 'AAPL',
      assetType: 'equity',
      alertType: ALERT_TYPES.PRICE_ABOVE,
      threshold: 100,
      enabled: true,
    })))
    const listed = parseResponse(await alertsHandler({ httpMethod: 'GET', headers: { ...auth2Headers(), 'x-request-id': 'req-alerts' }, queryStringParameters: auth2Query() }))
    const updated = parseResponse(await updateAlertHandler(postEvent({
      id: created.json.data.alert.id,
      symbol: 'AAPL',
      assetType: 'equity',
      alertType: ALERT_TYPES.PRICE_ABOVE,
      threshold: 90,
      enabled: false,
    })))
    const evaluated = parseResponse(await evaluateAlertsHandler(postEvent({
      quotes: { AAPL: { price: 110, changePercent: 1, volume: 1 } },
    })))
    const deleted = parseResponse(await deleteAlertHandler(postEvent({ id: created.json.data.alert.id })))
    const invalid = parseResponse(await createAlertHandler(postEvent({
      symbol: '../AAPL',
      alertType: ALERT_TYPES.PRICE_ABOVE,
      threshold: 100,
    })))

    expect(created.statusCode).toBe(200)
    expect(created.json.data.alert.symbol).toBe('AAPL')
    expect(listed.json.data.alerts).toHaveLength(1)
    expect(updated.json.data.alert.enabled).toBe(false)
    expect(evaluated.json).toMatchObject({ ok: true, data: { triggeredAlerts: expect.any(Array) } })
    expect(deleted.json.data.deleted).toBe(true)
    expect(invalid.statusCode).toBe(400)
    expect(invalid.json.error).toMatchObject({
      code: 'invalid_symbol',
      requestId: expect.any(String),
    })
  })

  it('renders AlertsPanel and supports create, update, disable, enable, delete, and evaluate actions', async () => {
    const state = {
      alerts: [],
      triggeredAlerts: [],
      isLoading: false,
      isRefreshing: false,
      error: null,
      refresh: vi.fn(),
      createAlert: vi.fn(async (payload) => ({ id: 'alert-1', ...payload })),
      updateAlert: vi.fn(async (payload) => payload),
      deleteAlert: vi.fn(async () => true),
      setAlertEnabled: vi.fn(async () => true),
      evaluateAlerts: vi.fn(async () => []),
    }
    renderWithRoot(<AlertsPanel activeSymbol="AAPL" alertsState={state} />)

    expect(container.textContent).toContain('Alerts')
    expect(container.textContent).toContain('No alerts configured')

    await act(async () => {
      container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })
    expect(state.createAlert).toHaveBeenCalledWith(expect.objectContaining({
      symbol: 'AAPL',
      alertType: ALERT_TYPES.PRICE_ABOVE,
      channels: { inApp: true },
    }))

    const alertState = {
      ...state,
      alerts: [{ id: 'alert-1', symbol: 'AAPL', assetType: 'equity', alertType: ALERT_TYPES.PRICE_ABOVE, threshold: 100, enabled: true }],
      triggeredAlerts: [{ alertId: 'alert-1', triggeredAt: 'now', message: 'AAPL price alert' }],
    }
    renderWithRoot(<AlertsPanel activeSymbol="AAPL" alertsState={alertState} />)

    await act(async () => {
      const buttons = [...container.querySelectorAll('button')]
      buttons.find((button) => button.textContent === 'Evaluate').click()
      buttons.find((button) => button.textContent === 'Edit').click()
    })
    await act(async () => {
      container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })
    await act(async () => {
      const buttons = [...container.querySelectorAll('button')]
      buttons.find((button) => button.textContent === 'Disable').click()
      buttons.find((button) => button.textContent === 'Delete').click()
    })

    expect(alertState.evaluateAlerts).toHaveBeenCalled()
    expect(alertState.updateAlert).toHaveBeenCalled()
    expect(alertState.setAlertEnabled).toHaveBeenCalledWith(alertState.alerts[0], false)
    expect(alertState.deleteAlert).toHaveBeenCalledWith('alert-1')
    expect(container.textContent).toContain('AAPL price alert')
  })
})
