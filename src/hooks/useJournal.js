import { useCallback, useEffect, useState } from 'react'
import { workspaceApiClient } from '../api/workspaceApiClient.js'
import { useEventBus } from './useEventBus.js'

export function useJournal({ search = '', symbol = 'all', result = 'all' } = {}) {
  const [entries, setEntries] = useState([])
  const [filteredEntries, setFilteredEntries] = useState([])
  const [symbols, setSymbols] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setIsRefreshing(true)
    setError(null)

    try {
      const response = await workspaceApiClient.getJournalSummary({ search, symbol, result })
      setFilteredEntries(response.entries ?? [])
      setEntries(response.entries ?? [])
      setSymbols(response.symbols ?? [])
      return response.entries ?? []
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'Unable to load journal')
      return []
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [result, search, symbol])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Auto-refresh when journal events fire
  useEventBus('journal:created', () => void refresh(), [refresh])

  return {
    entries,
    filteredEntries,
    symbols,
    isLoading,
    isRefreshing,
    error,
    refresh,
  }
}
