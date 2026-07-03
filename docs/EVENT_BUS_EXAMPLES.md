/**
 * Event Bus Integration Examples
 * 
 * Real-world examples of how to use the event bus in Atlas Market
 * without breaking existing code.
 * 
 * These examples show the integration points but don't modify existing files yet.
 */

// ============================================================================
// EXAMPLE 1: Backend - Emit Events After Order Creation
// ============================================================================

// File: netlify/functions/submit-paper-order.js (Future integration)
// This is how we'd integrate - doesn't change existing code yet

import { eventBus } from '../../lib/core/eventBus.js'

async function submitOrderWithEvents(payload, context) {
  // Existing code: creates order
  const order = await orderEngine.createOrder(payload, quote, portfolio)

  // NEW: Emit event so frontend knows to refresh
  eventBus.emit('order:created', { order })

  return { ok: true, data: { order } }
}

// ============================================================================
// EXAMPLE 2: Backend - Multiple Systems React to Same Event
// ============================================================================

// Different systems can independently listen to events

// In alert-system.js
eventBus.subscribe('portfolio:updated', async () => {
  console.log('Portfolio changed, re-evaluating alerts...')
  await evaluateAllAlerts()
})

// In analytics-system.js
eventBus.subscribe('portfolio:updated', async () => {
  console.log('Portfolio changed, updating analytics...')
  await recalculatePerformanceMetrics()
})

// In journal-system.js
eventBus.subscribe(['order:created', 'order:cancelled'], async (payload) => {
  console.log('Order event, logging to journal...')
  await journalEngine.logOrderEvent(payload)
})

// ============================================================================
// EXAMPLE 3: React Hook - Listen to Events and Refresh Data
// ============================================================================

// File: src/hooks/usePortfolioAnalytics.js (Future integration)

import { useState, useCallback, useEffect } from 'react'
import { useEventBus } from './useEventBus.js'
import { workspaceApiClient } from '../api/workspaceApiClient.js'

export function usePortfolioAnalytics() {
  const [summary, setSummary] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    try {
      setError(null)
      const response = await workspaceApiClient.getPortfolioSummary()
      setSummary(response.summary)
    } catch (err) {
      setError(err.message)
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Initial load
  useEffect(() => {
    void refresh()
  }, [refresh])

  // NEW: Auto-refresh when orders change
  useEventBus(['order:created', 'order:updated', 'order:cancelled'], refresh)

  return { summary, isLoading, error, refresh }
}

// ============================================================================
// EXAMPLE 4: React Component - Emit Events on User Actions
// ============================================================================

// File: src/components/panels.jsx (Future integration)

import { useEventBusEmit } from '../hooks/useEventBus.js'

export function OrderEntryPanel(props) {
  const emit = useEventBusEmit()

  const handleSubmitOrder = async (formData) => {
    try {
      const response = await workspaceApiClient.submitPaperOrder(formData)

      // NEW: Notify other components via event
      emit('order:created', { order: response.order })

      // Show success message
      setFormMessage({ type: 'success', text: 'Order submitted' })

      // Clear form
      resetForm()
    } catch (error) {
      setFormMessage({ type: 'error', text: error.message })
    }
  }

  return (
    <form onSubmit={handleSubmitOrder}>
      {/* Existing form fields */}
    </form>
  )
}

// ============================================================================
// EXAMPLE 5: Multiple Panels Listening to Same Event
// ============================================================================

// File: src/App.jsx (Future enhancement)

export function App() {
  // Existing hooks...
  const orders = useOrders()
  const portfolio = usePortfolioAnalytics()
  const equityCurve = useEquityCurve()

  // NEW: All these panels auto-refresh when order:created event fires
  // No manual coordination needed!

  return (
    <DashboardLayout>
      <OrdersPanel orders={orders.data} />
      <PortfolioSummaryPanel summary={portfolio.summary} />
      <EquityCurvePanel points={equityCurve.points} />
    </DashboardLayout>
  )
}

// Each panel can independently listen to same event:
//
// In useOrders hook:
// useEventBus(['order:created', 'order:updated'], refresh)
//
// In usePortfolioAnalytics hook:
// useEventBus(['order:created', 'order:updated'], refresh)
//
// In useEquityCurve hook:
// useEventBus('order:created', refresh)
//
// Result: All three panels auto-refresh without explicit coordination

// ============================================================================
// EXAMPLE 6: Error Event for System Health
// ============================================================================

// NEW: Applications can also emit system events

import { eventBus } from '../../lib/core/eventBus.js'

// In API error handler:
if (response.status === 429) {
  eventBus.emit('system:rate-limited', { endpoint: path, retryAfter: 60 })
}

// In React component:
import { useEventBus } from '../hooks/useEventBus.js'

export function DiagnosticsPanel() {
  const [alerts, setAlerts] = useState([])

  // Listen for system errors
  useEventBus(['system:rate-limited', 'system:error'], (payload) => {
    setAlerts((prev) => [...prev, payload])
  })

  return (
    <div>
      {alerts.map((alert) => (
        <Alert key={alert.timestamp} severity="warning">
          {alert.message}
        </Alert>
      ))}
    </div>
  )
}

// ============================================================================
// EXAMPLE 7: Custom Hook Using Event Bus Internally
// ============================================================================

export function useOrderWorkflow() {
  const [orders, setOrders] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const emit = useEventBusEmit()

  useEffect(() => {
    refreshOrders()
  }, [])

  const refreshOrders = useCallback(async () => {
    const response = await workspaceApiClient.getOrders()
    setOrders(response.orders)
  }, [])

  const submitOrder = useCallback(
    async (orderData) => {
      const result = await workspaceApiClient.submitPaperOrder(orderData)

      // NEW: Automatically emit event
      emit('order:created', { order: result.order })

      // Hook automatically refreshes via listener too
      await refreshOrders()

      return result
    },
    [emit]
  )

  const cancelOrder = useCallback(
    async (orderId, reason) => {
      const result = await workspaceApiClient.cancelPaperOrder(orderId)

      // NEW: Emit event
      emit('order:cancelled', { orderId, reason })

      await refreshOrders()

      return result
    },
    [emit]
  )

  // NEW: Auto-refresh on related events
  useEventBus(
    ['order:updated', 'portfolio:updated'],
    refreshOrders,
    []
  )

  return {
    orders,
    isLoading,
    submitOrder,
    cancelOrder,
    refresh: refreshOrders,
  }
}

// ============================================================================
// EXAMPLE 8: Testing with Event Bus
// ============================================================================

import { describe, it, expect, beforeEach } from 'vitest'
import { createEventBus } from '../../lib/core/eventBus.js'

describe('Order submission with events', () => {
  let bus

  beforeEach(() => {
    bus = createEventBus()
  })

  it('should emit order:created when order is submitted', async () => {
    const listener = vi.fn()
    bus.subscribe('order:created', listener)

    // Simulate order creation
    const order = { id: '123', symbol: 'AAPL', quantity: 100 }
    bus.emit('order:created', { order })

    expect(listener).toHaveBeenCalledWith({ order })
  })

  it('should allow multiple listeners to react to same event', async () => {
    const listener1 = vi.fn()
    const listener2 = vi.fn()

    bus.subscribe('order:created', listener1)
    bus.subscribe('order:created', listener2)

    const order = { id: '123', symbol: 'AAPL' }
    bus.emit('order:created', { order })

    expect(listener1).toHaveBeenCalledWith({ order })
    expect(listener2).toHaveBeenCalledWith({ order })
  })
})

// ============================================================================
// EXAMPLE 9: Gradual Migration Path
// ============================================================================

// Phase 1: Add event bus (DONE)
// - Event bus created at lib/core/eventBus.js
// - React hook at src/hooks/useEventBus.js
// - No existing code changed

// Phase 2: Add event emission (next step)
// - Update orderEngine to emit 'order:created'
// - Update portfolioEngine to emit 'portfolio:updated'
// - Update journalEngine to emit 'journal:created'

// Phase 3: Add event listeners in hooks (after Phase 2)
// - usePortfolioAnalytics listens to 'order:created'
// - useOrders listens to 'order:updated'
// - useEquityCurve listens to 'order:created'

// Phase 4: Reduce manual refresh calls (after Phase 3)
// - Remove manual refreshOrders() calls from component buttons
// - Remove manual portfolio refresh after order submission

// Phase 5: Consider advanced patterns (future)
// - React Query for client-side caching
// - WebSocket for real-time events
// - Event replay for state recovery

// ============================================================================
// EXAMPLE 10: Memory Leak Prevention - Before and After
// ============================================================================

// BEFORE: Manual subscription without cleanup
// ❌ Memory leak
function ComponentWithoutCleanup() {
  useEffect(() => {
    eventBus.subscribe('order:created', handleOrderCreated)
    // Missing cleanup function!
  }, [])

  return <div>Orders</div>
}

// AFTER: Using useEventBus hook
// ✓ Automatic cleanup
import { useEventBus } from '../hooks/useEventBus.js'

function ComponentWithCleanup() {
  useEventBus('order:created', handleOrderCreated)
  // Hook handles cleanup automatically on unmount

  return <div>Orders</div>
}

// ============================================================================
// SUMMARY
// ============================================================================

/*
Key Integration Points:

1. Backend Emissions:
   - After orderEngine.createOrder() → emit 'order:created'
   - After positionEngine.applyFill() → emit 'position:updated'
   - After journalEngine.create() → emit 'journal:created'

2. Frontend Listeners:
   - usePortfolioAnalytics listens to 'order:*'
   - useEquityCurve listens to 'order:created', 'journal:created'
   - useOrders listens to 'order:updated'
   - usePositions listens to 'position:updated'

3. Benefits:
   - No breaking changes to existing code
   - Automatic UI refresh after mutations
   - Decoupled components (no prop drilling)
   - Testable event flows
   - Memory leak prevention

4. Next Steps:
   - Decide which events to emit first
   - Update one hook at a time to listen
   - Test event flow end-to-end
   - Remove manual refresh calls once working
*/
