/**
 * React hook for subscribing to event bus events
 * 
 * Handles cleanup automatically via useEffect
 * Prevents memory leaks by unsubscribing on unmount or dependency changes
 * 
 * Usage:
 * 
 * // Single event
 * useEventBus('order:created', (payload) => {
 *   console.log('New order:', payload.order)
 * })
 * 
 * // Multiple events with same handler
 * useEventBus(['order:created', 'order:updated'], (payload) => {
 *   refreshOrders()
 * })
 * 
 * // With dependencies
 * useEventBus('position:updated', handlePositionUpdate, [accountValue])
 */

import { useCallback, useEffect } from 'react'
import { eventBus } from '../../lib/core/eventBus.js'

/**
 * Hook to subscribe to event bus events
 * Automatically unsubscribes on unmount or dependency change
 * 
 * @param {string|string[]} events - Event name(s) to listen for
 * @param {Function} callback - Callback function(payload)
 * @param {Array} [dependencies] - Optional dependency array for useEffect
 */
export function useEventBus(events, callback, dependencies = []) {
  useEffect(() => {
    if (!callback || typeof callback !== 'function') {
      return
    }

    // Normalize events to array
    const eventList = Array.isArray(events) ? events : [events]

    // Subscribe to each event
    const unsubscribers = eventList.map((event) => {
      if (typeof event !== 'string') {
        console.warn('Event name must be a string, skipping:', event)
        return null
      }
      return eventBus.subscribe(event, callback)
    })

    // Return cleanup function
    return () => {
      unsubscribers.forEach((unsubscribe) => {
        if (unsubscribe && typeof unsubscribe === 'function') {
          unsubscribe()
        }
      })
    }
  }, [callback, ...dependencies])
}

/**
 * Hook to emit events
 * Returns memoized emit function
 * 
 * Usage:
 * const emit = useEventBusEmit()
 * emit('order:created', { order: newOrder })
 */
export function useEventBusEmit() {
  return useCallback((event, payload) => {
    eventBus.emit(event, payload)
  }, [])
}
