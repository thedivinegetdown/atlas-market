import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react-dom/test-utils'
import { createRoot } from 'react-dom/client'
import { createScannerRepository } from '../lib/repositories/scannerRepository.js'
import { resetStore } from '../lib/repositories/store.js'
import { SCANNER_CRITERIA } from '../lib/scanners/scannerCriteria.js'
import { createScannerEvaluator } from '../lib/scanners/scannerEvaluator.js'
import { validateScannerPayload } from '../lib/scanners/scannerValidator.js'
import { handler as createScannerHandler } from '../netlify/functions/create-scanner.js'
import { handler as deleteScannerHandler } from '../netlify/functions/delete-scanner.js'
import { handler as evaluateScannersHandler } from '../netlify/functions/evaluate-scanners.js'
import { handler as scannersHandler } from '../netlify/functions/scanners.js'
import { handler as updateScannerHandler } from '../netlify/functions/update-scanner.js'
import { ScannerPanel } from '../src/components/panels.jsx'

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
  return { statusCode: response.statusCode, json: JSON.parse(response.body) }
}

function postEvent(body) {
  return {
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json', 'x-request-id': 'req-scanners' },
    body: JSON.stringify(body),
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

describe('Part 13C scanner foundation', () => {
  it('validates scanner payloads and rejects unsafe or invalid input', () => {
    const valid = validateScannerPayload({
      name: 'Momentum',
      assetType: 'equity',
      symbols: ['spy', 'aapl'],
      criteria: [{ type: SCANNER_CRITERIA.PRICE_ABOVE, threshold: '100' }],
      enabled: true,
    })
    const invalidName = validateScannerPayload({ assetType: 'equity', symbols: ['AAPL'], criteria: [{ type: SCANNER_CRITERIA.PRICE_ABOVE, threshold: 1 }] })
    const invalidUniverse = validateScannerPayload({ name: 'Bad', assetType: 'equity', symbols: [], criteria: [{ type: SCANNER_CRITERIA.PRICE_ABOVE, threshold: 1 }] })
    const invalidCriterion = validateScannerPayload({ name: 'Bad', assetType: 'equity', symbols: ['AAPL'], criteria: [{ type: 'unknown' }] })
    const invalidThreshold = validateScannerPayload({ name: 'Bad', assetType: 'equity', symbols: ['AAPL'], criteria: [{ type: SCANNER_CRITERIA.PRICE_ABOVE, threshold: 'nope' }] })
    const unsafe = validateScannerPayload(JSON.parse('{"name":"Bad","assetType":"equity","symbols":["AAPL"],"criteria":[{"type":"price_above","threshold":1}],"__proto__":{"x":true}}'))

    expect(valid.scanner).toMatchObject({
      name: 'Momentum',
      assetType: 'equity',
      symbols: ['SPY', 'AAPL'],
      criteria: [{ type: SCANNER_CRITERIA.PRICE_ABOVE, threshold: 100 }],
      enabled: true,
    })
    expect(invalidName.error.code).toBe('invalid_scanner_name')
    expect(invalidUniverse.error.code).toBe('invalid_symbol_universe')
    expect(invalidCriterion.error.code).toBe('invalid_scanner_criterion')
    expect(invalidThreshold.error.code).toBe('invalid_threshold')
    expect(unsafe.error.code).toBe('unsafe_payload_key')
  })

  it('supports scanner repository create, update, delete, list, find, and enable state', () => {
    const repository = createScannerRepository()
    const created = repository.create({
      name: 'Momentum',
      assetType: 'equity',
      symbols: ['AAPL'],
      criteria: [{ type: SCANNER_CRITERIA.PRICE_ABOVE, threshold: 100 }],
      enabled: true,
    })
    const found = repository.find(created.id)
    const updated = repository.update(created.id, () => ({ name: 'Breakout' }))
    const disabled = repository.setEnabled(created.id, false)

    expect(repository.list()).toHaveLength(1)
    expect(found.name).toBe('Momentum')
    expect(updated.name).toBe('Breakout')
    expect(disabled.enabled).toBe(false)
    expect(repository.delete(created.id)).toBe(true)
    expect(repository.list()).toHaveLength(0)
  })

  it('evaluates price, volume, signal, and risk acceptable criteria', async () => {
    const evaluator = createScannerEvaluator({
      now: () => '2026-07-02T00:00:00.000Z',
      marketDataService: {
        async getQuotes() {
          return [{
            symbol: 'AAPL',
            price: 125,
            changePercent: 2,
            volume: 1000000,
            volatility: 4,
            updatedAt: new Date().toISOString(),
          }]
        },
      },
      signalEngine: {
        evaluateQuote() {
          return { action: 'BUY' }
        },
      },
      riskEngine: {
        evaluateOrder() {
          return { approved: true }
        },
      },
    })
    const matches = await evaluator.evaluate([{
      id: 'scanner-1',
      name: 'Momentum',
      assetType: 'equity',
      symbols: ['AAPL'],
      enabled: true,
      criteria: [
        { type: SCANNER_CRITERIA.PRICE_ABOVE, threshold: 100 },
        { type: SCANNER_CRITERIA.VOLUME_ABOVE, threshold: 500000 },
        { type: SCANNER_CRITERIA.SIGNAL_BULLISH },
        { type: SCANNER_CRITERIA.RISK_ACCEPTABLE },
      ],
    }])

    expect(matches).toEqual([expect.objectContaining({
      scannerId: 'scanner-1',
      scannerName: 'Momentum',
      symbol: 'AAPL',
      assetType: 'equity',
      matchedCriteria: [
        SCANNER_CRITERIA.PRICE_ABOVE,
        SCANNER_CRITERIA.VOLUME_ABOVE,
        SCANNER_CRITERIA.SIGNAL_BULLISH,
        SCANNER_CRITERIA.RISK_ACCEPTABLE,
      ],
      evaluatedAt: '2026-07-02T00:00:00.000Z',
    })])
  })

  it('returns API success and error shapes for scanner CRUD and evaluation', async () => {
    const created = parseResponse(await createScannerHandler(postEvent({
      name: 'Momentum',
      assetType: 'equity',
      symbols: ['AAPL'],
      criteria: [{ type: SCANNER_CRITERIA.PRICE_ABOVE, threshold: 100 }],
      enabled: true,
    })))
    const listed = parseResponse(await scannersHandler({ httpMethod: 'GET', headers: { 'x-request-id': 'req-scanners' } }))
    const updated = parseResponse(await updateScannerHandler(postEvent({
      id: created.json.data.scanner.id,
      name: 'Momentum Updated',
      assetType: 'equity',
      symbols: ['AAPL'],
      criteria: [{ type: SCANNER_CRITERIA.PRICE_BELOW, threshold: 200 }],
      enabled: false,
    })))
    const evaluated = parseResponse(await evaluateScannersHandler(postEvent({})))
    const deleted = parseResponse(await deleteScannerHandler(postEvent({ id: created.json.data.scanner.id })))
    const invalid = parseResponse(await createScannerHandler(postEvent({
      name: 'Bad',
      assetType: 'bond',
      symbols: ['AAPL'],
      criteria: [{ type: SCANNER_CRITERIA.PRICE_ABOVE, threshold: 100 }],
    })))

    expect(created.statusCode).toBe(200)
    expect(created.json.data.scanner.name).toBe('Momentum')
    expect(listed.json.data.scanners).toHaveLength(1)
    expect(updated.json.data.scanner.enabled).toBe(false)
    expect(evaluated.json).toMatchObject({ ok: true, data: { matches: expect.any(Array) } })
    expect(deleted.json.data.deleted).toBe(true)
    expect(invalid.statusCode).toBe(400)
    expect(invalid.json.error).toMatchObject({ code: 'invalid_asset_type', requestId: expect.any(String) })
  })

  it('renders ScannerPanel and supports create, update, disable, enable, delete, and evaluate actions', async () => {
    const state = {
      scanners: [],
      matches: [],
      isLoading: false,
      isRefreshing: false,
      error: null,
      refresh: vi.fn(),
      createScanner: vi.fn(async (payload) => ({ id: 'scanner-1', ...payload })),
      updateScanner: vi.fn(async (payload) => payload),
      deleteScanner: vi.fn(async () => true),
      setScannerEnabled: vi.fn(async () => true),
      evaluateScanners: vi.fn(async () => []),
    }
    renderWithRoot(<ScannerPanel scannersState={state} />)

    expect(container.textContent).toContain('Scanner')
    expect(container.textContent).toContain('No scanners configured')

    await act(async () => {
      container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })
    expect(state.createScanner).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Momentum Scan',
      symbols: ['SPY', 'QQQ', 'AAPL'],
      criteria: [{ type: SCANNER_CRITERIA.PRICE_ABOVE, threshold: '100' }],
    }))

    const scannerState = {
      ...state,
      scanners: [{
        id: 'scanner-1',
        name: 'Momentum',
        assetType: 'equity',
        symbols: ['AAPL'],
        criteria: [{ type: SCANNER_CRITERIA.PRICE_ABOVE, threshold: 100 }],
        enabled: true,
      }],
      matches: [{
        scannerId: 'scanner-1',
        scannerName: 'Momentum',
        symbol: 'AAPL',
        assetType: 'equity',
        matchedCriteria: [SCANNER_CRITERIA.PRICE_ABOVE],
        evaluatedAt: '2026-07-02T00:00:00.000Z',
      }],
    }
    renderWithRoot(<ScannerPanel scannersState={scannerState} />)

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

    expect(scannerState.evaluateScanners).toHaveBeenCalled()
    expect(scannerState.updateScanner).toHaveBeenCalled()
    expect(scannerState.setScannerEnabled).toHaveBeenCalledWith(scannerState.scanners[0], false)
    expect(scannerState.deleteScanner).toHaveBeenCalledWith('scanner-1')
    expect(container.textContent).toContain('Momentum')
    expect(container.textContent).toContain('AAPL')
  })
})
