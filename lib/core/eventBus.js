/**
 * Lightweight event bus for Atlas Market
 * 
 * Works in both Node.js and browser environments
 * No external dependencies required
 * 
 * Features:
 * - subscribe(event, callback): Register callback for event
 * - emit(event, payload): Emit event to all subscribers
 * - unsubscribe(event, callback): Remove specific callback
 * - unsubscribeAll(event): Remove all callbacks for event
 * - clear(): Clear all subscribers
 * 
 * Events:
 * - order:created: { order: Order object }
 * - order:updated: { orderId: string, changes: object }
 * - order:cancelled: { orderId: string, reason: string }
 * - portfolio:updated: { portfolio: Portfolio object }
 * - position:updated: { symbol: string, position: Position object }
 * - journal:created: { entry: JournalEntry object }
 */

export function createEventBus() {
  // Map<eventName, Set<callback>>
  const subscribers = new Map()

  /**
   * Subscribe to an event
   * @param {string} event - Event name
   * @param {Function} callback - Callback function(payload)
   * @returns {Function} Unsubscribe function
   */
  function subscribe(event, callback) {
    if (typeof event !== 'string') {
      throw new Error('Event name must be a string')
    }
    if (typeof callback !== 'function') {
      throw new Error('Callback must be a function')
    }

    if (!subscribers.has(event)) {
      subscribers.set(event, new Set())
    }

    const callbacks = subscribers.get(event)
    callbacks.add(callback)

    // Return unsubscribe function for easy cleanup
    return () => {
      callbacks.delete(callback)
      // Clean up empty event entries to prevent memory leaks
      if (callbacks.size === 0) {
        subscribers.delete(event)
      }
    }
  }

  /**
   * Emit an event to all subscribers
   * @param {string} event - Event name
   * @param {*} payload - Data to pass to callbacks
   */
  function emit(event, payload) {
    if (typeof event !== 'string') {
      throw new Error('Event name must be a string')
    }

    if (!subscribers.has(event)) {
      return // No subscribers for this event
    }

    const callbacks = subscribers.get(event)

    // Create array copy to handle callbacks removing themselves mid-emit
    const callbackArray = Array.from(callbacks)

    for (const callback of callbackArray) {
      try {
        callback(payload)
      } catch (error) {
        // Prevent one callback's error from breaking others
        console.error(`Error in event handler for "${event}":`, error)
      }
    }
  }

  /**
   * Unsubscribe specific callback from event
   * @param {string} event - Event name
   * @param {Function} callback - Callback to remove
   */
  function unsubscribe(event, callback) {
    if (!subscribers.has(event)) {
      return
    }

    const callbacks = subscribers.get(event)
    callbacks.delete(callback)

    // Clean up empty event entries to prevent memory leaks
    if (callbacks.size === 0) {
      subscribers.delete(event)
    }
  }

  /**
   * Remove all subscribers for an event
   * @param {string} event - Event name
   */
  function unsubscribeAll(event) {
    subscribers.delete(event)
  }

  /**
   * Clear all subscribers from all events
   * Use with caution - typically only for testing or shutdown
   */
  function clear() {
    subscribers.clear()
  }

  /**
   * Get number of subscribers for an event (for debugging/testing)
   * @param {string} event - Event name
   * @returns {number} Number of subscribers
   */
  function getSubscriberCount(event) {
    if (!subscribers.has(event)) {
      return 0
    }
    return subscribers.get(event).size
  }

  /**
   * Get all events with at least one subscriber (for debugging)
   * @returns {string[]} Array of event names
   */
  function getActiveEvents() {
    return Array.from(subscribers.keys())
  }

  return {
    subscribe,
    emit,
    unsubscribe,
    unsubscribeAll,
    clear,
    getSubscriberCount,
    getActiveEvents,
  }
}

// Export singleton instance
export const eventBus = createEventBus()
