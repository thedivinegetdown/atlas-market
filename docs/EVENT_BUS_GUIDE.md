# Event Bus Guide

Atlas Market's lightweight event bus enables decoupled communication between components and services without external dependencies.

## Architecture

The event bus uses a **publish-subscribe pattern**:
- **Producers** emit events with payloads
- **Subscribers** register callbacks to react to events
- **Memory leak prevention** through automatic cleanup of empty event entries

## Core Concepts

### Events

```javascript
import { eventBus } from '../lib/core/eventBus.js'

// Emit event
eventBus.emit('order:created', { order: newOrder })

// Subscribe to event
eventBus.subscribe('order:created', (payload) => {
  console.log('Order created:', payload.order)
})
```

### Standard Events

| Event | Payload | Purpose |
|-------|---------|---------|
| `order:created` | `{ order: Order }` | New order created |
| `order:updated` | `{ orderId: string, changes: object }` | Order state changed |
| `order:cancelled` | `{ orderId: string, reason: string }` | Order cancelled |
| `portfolio:updated` | `{ portfolio: Portfolio }` | Portfolio state changed |
| `position:updated` | `{ symbol: string, position: Position }` | Position changed |
| `journal:created` | `{ entry: JournalEntry }` | Journal entry recorded |

## Usage

### Backend (Node.js)

```javascript
import { eventBus } from '../lib/core/eventBus.js'

// In netlify/functions/submit-paper-order.js
export async function submitOrder(payload) {
  const order = await orderEngine.createOrder(payload)
  
  // Notify subscribers
  eventBus.emit('order:created', { order })
  
  return { ok: true, data: order }
}

// In netlify/functions/evaluate-alerts.js
eventBus.subscribe('order:created', async (payload) => {
  // Portfolio changed, re-evaluate alerts
  await evaluateAllAlerts()
})
```

### Frontend (React)

#### Option 1: Direct Hook Usage (Recommended for React Components)

```javascript
import { useEventBus } from '../hooks/useEventBus.js'

export function OrdersPanel() {
  const [orders, setOrders] = useState([])
  
  // Listen for order events and refresh
  useEventBus(['order:created', 'order:updated', 'order:cancelled'], 
    async () => {
      const updated = await workspaceApiClient.getOrders()
      setOrders(updated.orders)
    }
  )
  
  return <div>{/* render orders */}</div>
}
```

#### Option 2: Direct Event Bus (For Custom Logic)

```javascript
import { eventBus } from '../lib/core/eventBus.js'

function setupOrderListener() {
  const unsubscribe = eventBus.subscribe('order:created', (payload) => {
    console.log('New order:', payload.order)
    // Custom logic
  })
  
  // Later: unsubscribe()
  return unsubscribe
}
```

#### Option 3: Emit Events

```javascript
import { useEventBusEmit } from '../hooks/useEventBus.js'

export function OrderEntryPanel() {
  const emit = useEventBusEmit()
  
  const handleSubmit = async (orderData) => {
    const result = await workspaceApiClient.submitPaperOrder(orderData)
    
    // Notify other components
    emit('order:created', { order: result.order })
  }
  
  return <form onSubmit={handleSubmit}>{/* ... */}</form>
}
```

### Multiple Events

```javascript
// Listen to multiple events with same handler
useEventBus(
  ['order:created', 'order:updated', 'order:cancelled'],
  () => refreshUI(),
  [refreshUI] // dependency array
)
```

### Manual Subscription Management

```javascript
import { eventBus } from '../lib/core/eventBus.js'

// Subscribe
const unsubscribe = eventBus.subscribe('event:name', callback)

// Manually unsubscribe
unsubscribe()

// Or use unsubscribe method
eventBus.unsubscribe('event:name', callback)

// Remove all subscribers for event
eventBus.unsubscribeAll('event:name')

// Clear all subscriptions (use carefully!)
eventBus.clear()
```

## Memory Leak Prevention

### Automatic Cleanup with useEventBus Hook

```javascript
// Hook handles cleanup automatically
useEventBus('order:created', (payload) => {
  // Callback runs
})
// When component unmounts: automatically unsubscribed
```

### Manual Cleanup

```javascript
useEffect(() => {
  const unsubscribe = eventBus.subscribe('order:created', handler)
  
  return () => {
    // Cleanup on unmount
    unsubscribe()
  }
}, [])
```

### Why Memory Leaks Are Prevented

1. **Empty Event Cleanup**: When last subscriber unsubscribes, event entry is deleted from Map
2. **Unsubscribe Function**: `subscribe()` returns cleanup function for easy React integration
3. **useEffect Cleanup**: Hook automatically calls cleanup on unmount/dependency change

```javascript
// Example: No memory leak
for (let i = 0; i < 1000; i++) {
  const unsub = bus.subscribe('event', () => {})
  unsub() // Immediately cleaned up
}
// Result: 0 active events, 0 memory accumulated
```

## Error Handling

### Safe Error Propagation

Errors in one callback don't break others:

```javascript
eventBus.subscribe('order:created', () => {
  throw new Error('oops')
})

eventBus.subscribe('order:created', () => {
  // This still runs!
  console.log('other callback')
})

eventBus.emit('order:created', {})
// Both callbacks execute, error is caught and logged
```

## Debugging

### Check Active Events

```javascript
// Get all events with subscribers
const activeEvents = eventBus.getActiveEvents()
console.log('Active events:', activeEvents)
// Output: ['order:created', 'portfolio:updated', 'position:updated']

// Check subscriber count
const count = eventBus.getSubscriberCount('order:created')
console.log('Subscribers:', count)
// Output: 3
```

## Patterns

### Refresh Multiple Panels After Mutation

```javascript
// In OrderEntryPanel
const handleOrderSubmit = async (orderData) => {
  const result = await workspaceApiClient.submitPaperOrder(orderData)
  
  // Single emit triggers multiple listeners
  eventBus.emit('order:created', { order: result.order })
}

// In PortfolioSummaryPanel
useEventBus('order:created', async () => {
  const portfolio = await workspaceApiClient.getPortfolioSummary()
  setPortfolio(portfolio)
})

// In EquityCurvePanel
useEventBus('order:created', async () => {
  const curve = await workspaceApiClient.getEquityCurve()
  setCurve(curve)
})

// All three panels refresh automatically
```

### One-Time Listener

```javascript
const listener = (payload) => {
  console.log('First order:', payload.order)
  eventBus.unsubscribe('order:created', listener)
}

eventBus.subscribe('order:created', listener)
```

### Batching Updates

```javascript
export function useEventBus(events, callback, dependencies = []) {
  useEffect(() => {
    // Can batch multiple subscriptions
    const unsubs = Array.isArray(events)
      ? events.map(e => eventBus.subscribe(e, callback))
      : [eventBus.subscribe(events, callback)]
    
    return () => unsubs.forEach(u => u?.())
  }, dependencies)
}
```

## Integration Points

### Where to Emit Events

1. **After successful API calls** in Netlify functions
   - `orderEngine.createOrder()` → emit `order:created`
   - `positionEngine.applyFill()` → emit `position:updated`
   - `journalRepository.create()` → emit `journal:created`

2. **In mutation hooks** in UI
   - `useOrderEntry().submit()` → emit `order:created`
   - `useOrders().cancel()` → emit `order:cancelled`

### Where to Subscribe

1. **In hooks** that need to refresh
   - `usePortfolioAnalytics()` → listen to `order:*` events
   - `usePositions()` → listen to `position:updated`
   - `useJournal()` → listen to `journal:created`

2. **In panels** that depend on other panels
   - PortfolioPanel listens to `order:created` to refresh
   - EquityCurvePanel listens to `journal:created` to recalculate

## Best Practices

✅ **DO:**
- Use `useEventBus` hook in React components (automatic cleanup)
- Emit specific, descriptive event names (`order:created` not `update`)
- Include relevant payload data in events
- Use dependency array with `useEventBus` for performance

❌ **DON'T:**
- Don't manually manage subscriptions in React without cleanup
- Don't emit sensitive data in payloads
- Don't use event bus as a replacement for component props/drilling (it's for sibling coordination)
- Don't forget to unsubscribe in manual setups

## Migration Path

The event bus is **non-breaking**. Existing code continues to work:

1. **Phase 1**: Add event bus, emit events after mutations
2. **Phase 2**: Update hooks to listen to events and auto-refresh
3. **Phase 3**: Remove manual refresh calls from UI
4. **Phase 4**: Consider React Query for more advanced caching

## Testing

```javascript
import { createEventBus } from '../lib/core/eventBus.js'
import { describe, it, expect, beforeEach } from 'vitest'

describe('Order workflow', () => {
  let bus
  
  beforeEach(() => {
    bus = createEventBus()
  })
  
  it('should notify on order creation', () => {
    const callback = vi.fn()
    bus.subscribe('order:created', callback)
    
    bus.emit('order:created', { order: { id: '1' } })
    
    expect(callback).toHaveBeenCalled()
  })
})
```

## FAQ

**Q: Is this a replacement for Redux/state management?**  
A: No. Use it for decoupled event notifications, not centralized state. For complex state, consider React Query or Redux later.

**Q: Can I use this across multiple browser tabs?**  
A: No, event bus is per-process. For cross-tab communication, use localStorage or BroadcastChannel API.

**Q: Will this slow down my app?**  
A: No. Event bus is lightweight—just a Map and Set. Emit/subscribe are O(1) operations.

**Q: What if I emit but no one subscribes?**  
A: Safely ignored. Emitting to non-existent events has no effect.

**Q: Can I inspect what events are active?**  
A: Yes, use `eventBus.getActiveEvents()` and `eventBus.getSubscriberCount(event)` for debugging.
