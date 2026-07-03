import { useCallback, useEffect, useMemo, useState } from 'react'
import { workspaceApiClient } from '../api/workspaceApiClient.js'

export function useScanners() {
  const [scanners, setScanners] = useState([])
  const [matches, setMatches] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setIsRefreshing(true)
    setError(null)

    try {
      const response = await workspaceApiClient.getScanners()
      setScanners(response.scanners ?? [])
      return response.scanners ?? []
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'Unable to load scanners')
      return []
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const createScanner = useCallback(async (payload) => {
    const response = await workspaceApiClient.createScanner(payload)
    await refresh()
    return response.scanner
  }, [refresh])

  const updateScanner = useCallback(async (payload) => {
    const response = await workspaceApiClient.updateScanner(payload)
    await refresh()
    return response.scanner
  }, [refresh])

  const deleteScanner = useCallback(async (id) => {
    const response = await workspaceApiClient.deleteScanner(id)
    await refresh()
    return response.deleted
  }, [refresh])

  const setScannerEnabled = useCallback((scanner, enabled) => {
    return updateScanner({ ...scanner, enabled })
  }, [updateScanner])

  const evaluateScanners = useCallback(async () => {
    const response = await workspaceApiClient.evaluateScanners()
    setMatches(response.matches ?? [])
    return response.matches ?? []
  }, [])

  return useMemo(() => ({
    scanners,
    matches,
    isLoading,
    isRefreshing,
    error,
    refresh,
    createScanner,
    updateScanner,
    deleteScanner,
    setScannerEnabled,
    evaluateScanners,
  }), [createScanner, deleteScanner, error, evaluateScanners, isLoading, isRefreshing, matches, refresh, scanners, setScannerEnabled, updateScanner])
}
