export function createPollingSubscription({
  fetcher,
  intervalMs = 15_000,
  onData = () => {},
  onError = () => {},
  scheduler = globalThis,
  immediate = true,
} = {}) {
  if (typeof fetcher !== 'function') {
    throw new Error('polling subscription fetcher is required')
  }

  let timerId = null
  let running = false

  async function refreshNow() {
    try {
      const data = await fetcher()
      onData(data)
      return data
    } catch (error) {
      onError(error)
      return null
    }
  }

  function scheduleNext() {
    if (!running) return
    timerId = scheduler.setTimeout(async () => {
      await refreshNow()
      scheduleNext()
    }, intervalMs)
  }

  return {
    start() {
      if (running) return
      running = true
      if (immediate) {
        void refreshNow()
      }
      scheduleNext()
    },

    stop() {
      running = false
      if (timerId !== null) {
        scheduler.clearTimeout(timerId)
        timerId = null
      }
    },

    refreshNow,

    isRunning() {
      return running
    },
  }
}
