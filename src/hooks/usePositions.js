import { useCallback, useEffect, useState } from 'react'
import { workspaceApiClient } from '../api/workspaceApiClient.js'

export function usePositions() {
  const [positions, setPositions] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setIsRefreshing(true)
    setError(null)

    try {
      const response = await workspaceApiClient.getPositions()
      setPositions(response.positions ?? [])
      return response.positions ?? []
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'Unable to load positions')
      return []
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return {
    positions,
    isLoading,
    isRefreshing,
    error,
    refresh,
  }
}
