import { describe, expect, it } from 'vitest'
import { createEventBus } from '../../../lib/core/eventBus.js'
import { applyPaperPortfolioAccounting } from '../accounting/paperPortfolioAccountingEngine.js'
import { simulateTradeExecution } from '../execution/executionSimulationEngine.js'
import { evaluateTradeGuardrail } from '../risk/tradeGuardrailEngine.js'
import {
  accountingDemoPortfolio,
  demoExecutionQuotes,
  demoProposedTrades,
  guardrailDemoPortfolio,
} from '../../data/demoPortfolio.js'
import {
  TRADE_JOURNAL_RECORDED_EVENT,
  createPaperTradeJournalEngine,
  recordPaperTradeJournal,
} from './paperTradeJournalEngine.js'

function buildLifecycle(trade = demoProposedTrades[0]) {
  const guardrailDecision = evaluateTradeGuardrail(guardrailDemoPortfolio, trade, { emitEvent: false })
  const executionSimulation = simulateTradeExecution(guardrailDecision, demoExecutionQuotes[trade.id], { emitEvent: false })
  const accountingUpdate = applyPaperPortfolioAccounting(accountingDemoPortfolio, executionSimulation, { emitEvent: false })

  return {
    proposedTrade: trade,
    guardrailDecision,
    executionSimulation,
    accountingUpdate,
  }
}

describe('paperTradeJournalEngine', () => {
  it('records a normalized paper trade lifecycle', () => {
    const record = recordPaperTradeJournal(buildLifecycle(), {
      emitEvent: false,
      timestamp: '2026-07-03T16:00:00Z',
    })

    expect(record.eventType).toBe(TRADE_JOURNAL_RECORDED_EVENT)
    expect(record.paperTrading).toBe(true)
    expect(record.journalStatus).toBe('recorded')
    expect(record.symbol).toBe('SPY')
    expect(record.side).toBe('buy')
    expect(record.quantity).toBe(8)
    expect(record.fill.fillPrice).toBeGreaterThan(0)
    expect(record.decisionGate).toEqual({
      guardrail: 'approved',
      execution: 'filled',
      accounting: 'position_increased',
    })
  })

  it('includes lifecycle snapshots, risk metrics, and event chain summary', () => {
    const record = recordPaperTradeJournal(buildLifecycle(), { emitEvent: false })

    expect(record.proposedTradeSnapshot.symbol).toBe('SPY')
    expect(record.guardrailDecisionSnapshot.eventType).toBe('trade.guardrail.evaluated')
    expect(record.executionSimulationSnapshot.eventType).toBe('trade.execution.simulated')
    expect(record.accountingUpdateSnapshot.eventType).toBe('portfolio.accounting.updated')
    expect(record.riskMetricsSnapshot).toMatchObject({
      tradeRiskPct: expect.any(Number),
      portfolioHeatAfterTrade: expect.any(Number),
      requiredCapital: expect.any(Number),
    })
    expect(record.eventChain.map((event) => event.eventType)).toEqual([
      'trade.guardrail.evaluated',
      'trade.execution.simulated',
      'portfolio.accounting.updated',
      TRADE_JOURNAL_RECORDED_EVENT,
    ])
  })

  it('marks rejected lifecycle when guardrail rejects the proposed trade', () => {
    const trade = demoProposedTrades[1]
    const guardrailDecision = evaluateTradeGuardrail(guardrailDemoPortfolio, trade, { emitEvent: false })
    const executionSimulation = simulateTradeExecution(guardrailDecision, demoExecutionQuotes[trade.id], { emitEvent: false })
    const accountingUpdate = applyPaperPortfolioAccounting(accountingDemoPortfolio, executionSimulation, { emitEvent: false })
    const record = recordPaperTradeJournal({
      proposedTrade: trade,
      guardrailDecision,
      executionSimulation,
      accountingUpdate,
    }, { emitEvent: false })

    expect(record.journalStatus).toBe('rejected')
    expect(record.decisionGate.guardrail).toBe('rejected')
    expect(record.decisionGate.execution).toBe('rejected')
    expect(record.fill).toBeNull()
  })

  it('marks rejected lifecycle when accounting rejects the update', () => {
    const lifecycle = buildLifecycle()
    const record = recordPaperTradeJournal({
      ...lifecycle,
      accountingUpdate: {
        eventType: 'portfolio.accounting.updated',
        status: 'rejected',
        reason: 'Accounting update rejected because simulated execution was not filled',
        account: { cash: 1000, equity: 1000, realizedPnl: 0 },
      },
    }, { emitEvent: false })

    expect(record.journalStatus).toBe('rejected')
    expect(record.reason).toContain('Accounting')
  })

  it('emits trade.journal.recorded', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(TRADE_JOURNAL_RECORDED_EVENT, (payload) => events.push(payload))

    const record = createPaperTradeJournalEngine({ eventBus }).record(buildLifecycle())

    expect(events).toHaveLength(1)
    expect(events[0].eventType).toBe(TRADE_JOURNAL_RECORDED_EVENT)
    expect(events[0].journalStatus).toBe(record.journalStatus)
  })
})
