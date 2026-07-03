/**
 * Event Bus Integration Tests
 * 
 * Tests core event bus functionality and React hook integration
 * Demonstrates usage patterns without breaking existing code
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createEventBus } from '../lib/core/eventBus.js'

describe('Event Bus', () => {
  let bus

  beforeEach(() => {
    bus = createEventBus()
  })

  afterEach(() => {
    bus.clear()
  })

  describe('subscribe and emit', () => {
    it('should notify subscribers when event is emitted', () => {
      const callback = vi.fn()
      bus.subscribe('test:event', callback)

      bus.emit('test:event', { data: 'test' })

      expect(callback).toHaveBeenCalledWith({ data: 'test' })
    })

    it('should support multiple subscribers for same event', () => {
      const callback1 = vi.fn()
      const callback2 = vi.fn()

      bus.subscribe('test:event', callback1)
      bus.subscribe('test:event', callback2)

      bus.emit('test:event', { data: 'test' })

      expect(callback1).toHaveBeenCalledWith({ data: 'test' })
      expect(callback2).toHaveBeenCalledWith({ data: 'test' })
    })

    it('should support multiple events', () => {
      const callback1 = vi.fn()
      const callback2 = vi.fn()

      bus.subscribe('event:one', callback1)
      bus.subscribe('event:two', callback2)

      bus.emit('event:one', { id: 1 })
      bus.emit('event:two', { id: 2 })

      expect(callback1).toHaveBeenCalledWith({ id: 1 })
      expect(callback2).toHaveBeenCalledWith({ id: 2 })
    })

    it('should handle events with no subscribers gracefully', () => {
      expect(() => {
        bus.emit('nonexistent:event', {})
      }).not.toThrow()
    })
  })

  describe('unsubscribe', () => {
    it('should remove specific callback', () => {
      const callback = vi.fn()
      bus.subscribe('test:event', callback)
      bus.unsubscribe('test:event', callback)

      bus.emit('test:event', {})

      expect(callback).not.toHaveBeenCalled()
    })

    it('should return unsubscribe function from subscribe', () => {
      const callback = vi.fn()
      const unsubscribe = bus.subscribe('test:event', callback)

      bus.emit('test:event', { data: 1 })
      expect(callback).toHaveBeenCalledTimes(1)

      unsubscribe()
      bus.emit('test:event', { data: 2 })

      expect(callback).toHaveBeenCalledTimes(1) // Still only called once
    })

    it('should remove only specific callback, leaving others', () => {
      const callback1 = vi.fn()
      const callback2 = vi.fn()

      bus.subscribe('test:event', callback1)
      bus.subscribe('test:event', callback2)
      bus.unsubscribe('test:event', callback1)

      bus.emit('test:event', { data: 'test' })

      expect(callback1).not.toHaveBeenCalled()
      expect(callback2).toHaveBeenCalledWith({ data: 'test' })
    })

    it('should clean up empty event entries to prevent memory leaks', () => {
      const callback = vi.fn()
      bus.subscribe('test:event', callback)

      expect(bus.getActiveEvents()).toContain('test:event')

      bus.unsubscribe('test:event', callback)

      expect(bus.getActiveEvents()).not.toContain('test:event')
    })
  })

  describe('unsubscribeAll', () => {
    it('should remove all subscribers for an event', () => {
      const callback1 = vi.fn()
      const callback2 = vi.fn()

      bus.subscribe('test:event', callback1)
      bus.subscribe('test:event', callback2)

      bus.unsubscribeAll('test:event')
      bus.emit('test:event', {})

      expect(callback1).not.toHaveBeenCalled()
      expect(callback2).not.toHaveBeenCalled()
    })
  })

  describe('error handling', () => {
    it('should catch errors in callbacks without breaking others', () => {
      const errorCallback = vi.fn(() => {
        throw new Error('callback error')
      })
      const normalCallback = vi.fn()

      bus.subscribe('test:event', errorCallback)
      bus.subscribe('test:event', normalCallback)

      expect(() => {
        bus.emit('test:event', {})
      }).not.toThrow()

      expect(normalCallback).toHaveBeenCalled()
    })

    it('should throw on invalid event name', () => {
      const callback = vi.fn()

      expect(() => {
        bus.subscribe(123, callback)
      }).toThrow()

      expect(() => {
        bus.emit(null, {})
      }).toThrow()
    })

    it('should throw on invalid callback', () => {
      expect(() => {
        bus.subscribe('test:event', 'not a function')
      }).toThrow()
    })
  })

  describe('debugging utilities', () => {
    it('should track subscriber count', () => {
      const callback1 = vi.fn()
      const callback2 = vi.fn()

      bus.subscribe('test:event', callback1)
      expect(bus.getSubscriberCount('test:event')).toBe(1)

      bus.subscribe('test:event', callback2)
      expect(bus.getSubscriberCount('test:event')).toBe(2)

      bus.unsubscribe('test:event', callback1)
      expect(bus.getSubscriberCount('test:event')).toBe(1)

      bus.unsubscribeAll('test:event')
      expect(bus.getSubscriberCount('test:event')).toBe(0)
    })

    it('should list active events', () => {
      const callback = vi.fn()

      bus.subscribe('event:one', callback)
      bus.subscribe('event:two', callback)

      const events = bus.getActiveEvents()
      expect(events).toContain('event:one')
      expect(events).toContain('event:two')
      expect(events.length).toBe(2)
    })
  })

  describe('clear', () => {
    it('should remove all subscribers', () => {
      const callback = vi.fn()

      bus.subscribe('event:one', callback)
      bus.subscribe('event:two', callback)

      bus.clear()

      bus.emit('event:one', {})
      bus.emit('event:two', {})

      expect(callback).not.toHaveBeenCalled()
    })
  })

  describe('real-world usage patterns', () => {
    it('should handle order workflow events', () => {
      const onOrderCreated = vi.fn()
      const onOrderUpdated = vi.fn()
      const onOrderCancelled = vi.fn()

      bus.subscribe('order:created', onOrderCreated)
      bus.subscribe('order:updated', onOrderUpdated)
      bus.subscribe('order:cancelled', onOrderCancelled)

      // Create order
      const order = { id: 'order-1', symbol: 'AAPL', quantity: 100 }
      bus.emit('order:created', { order })
      expect(onOrderCreated).toHaveBeenCalledWith({ order })

      // Update order
      bus.emit('order:updated', { orderId: 'order-1', changes: { status: 'FILLED' } })
      expect(onOrderUpdated).toHaveBeenCalledWith({ orderId: 'order-1', changes: { status: 'FILLED' } })

      // Cancel order
      bus.emit('order:cancelled', { orderId: 'order-1', reason: 'user_request' })
      expect(onOrderCancelled).toHaveBeenCalledWith({ orderId: 'order-1', reason: 'user_request' })
    })

    it('should allow same handler to listen to multiple events', () => {
      const refreshUI = vi.fn()

      bus.subscribe('order:created', refreshUI)
      bus.subscribe('order:updated', refreshUI)
      bus.subscribe('portfolio:updated', refreshUI)

      bus.emit('order:created', { order: {} })
      bus.emit('order:updated', { orderId: 'id' })
      bus.emit('portfolio:updated', { portfolio: {} })

      expect(refreshUI).toHaveBeenCalledTimes(3)
    })

    it('should support one-time listeners via wrapper', () => {
      const callback = vi.fn()
      const listener = (payload) => {
        callback(payload)
        bus.unsubscribe('test:event', listener)
      }

      bus.subscribe('test:event', listener)

      bus.emit('test:event', { id: 1 })
      bus.emit('test:event', { id: 2 })

      expect(callback).toHaveBeenCalledTimes(1)
      expect(callback).toHaveBeenCalledWith({ id: 1 })
    })

    it('should support async event handlers', async () => {
      const asyncCallback = vi.fn(async (payload) => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        return payload.data
      })

      bus.subscribe('test:event', asyncCallback)

      bus.emit('test:event', { data: 'async-test' })

      expect(asyncCallback).toHaveBeenCalledWith({ data: 'async-test' })
    })
  })

  describe('memory management', () => {
    it('should not accumulate event entries for unsubscribed events', () => {
      const callback = vi.fn()

      // Subscribe and unsubscribe 100 times
      for (let i = 0; i < 100; i++) {
        const unsub = bus.subscribe('test:event', callback)
        unsub()
      }

      // Should have no active events
      expect(bus.getActiveEvents()).toHaveLength(0)
    })

    it('should handle large number of subscribers', () => {
      const callbacks = Array.from({ length: 1000 }, () => vi.fn())

      callbacks.forEach((cb) => {
        bus.subscribe('test:event', cb)
      })

      expect(bus.getSubscriberCount('test:event')).toBe(1000)

      bus.emit('test:event', { data: 'test' })

      callbacks.forEach((cb) => {
        expect(cb).toHaveBeenCalledWith({ data: 'test' })
      })
    })
  })
})

describe('Singleton Event Bus', () => {
  it('should export singleton instance', () => {
    const { eventBus } = require('../lib/core/eventBus.js')
    
    // Verify it's an object with required methods
    expect(eventBus).toBeDefined()
    expect(typeof eventBus.subscribe).toBe('function')
    expect(typeof eventBus.emit).toBe('function')
    expect(typeof eventBus.unsubscribe).toBe('function')
  })
})
