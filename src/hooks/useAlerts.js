import { useCallback, useEffect, useMemo, useState } from 'react'
import { workspaceApiClient } from '../api/workspaceApiClient.js'

export function useAlerts() {
  const [alerts, setAlerts] = useState([])
  const [triggeredAlerts, setTriggeredAlerts] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setIsRefreshing(true)
    setError(null)

    try {
      const response = await workspaceApiClient.getAlerts()
      setAlerts(response.alerts ?? [])
      return response.alerts ?? []
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'Unable to load alerts')
      return []
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const createAlert = useCallback(async (payload) => {
    const response = await workspaceApiClient.createAlert(payload)
    await refresh()
    return response.alert
  }, [refresh])

  const updateAlert = useCallback(async (payload) => {
    const response = await workspaceApiClient.updateAlert(payload)
    await refresh()
    return response.alert
  }, [refresh])

  const deleteAlert = useCallback(async (id) => {
    const response = await workspaceApiClient.deleteAlert(id)
    await refresh()
    return response.deleted
  }, [refresh])

  const setAlertEnabled = useCallback((alert, enabled) => {
    return updateAlert({ ...alert, enabled })
  }, [updateAlert])

  const evaluateAlerts = useCallback(async (context = {}) => {
    const response = await workspaceApiClient.evaluateAlerts(context)
    setTriggeredAlerts(response.triggeredAlerts ?? [])
    return response.triggeredAlerts ?? []
  }, [])

  return useMemo(() => ({
    alerts,
    triggeredAlerts,
    isLoading,
    isRefreshing,
    error,
    refresh,
    createAlert,
    updateAlert,
    deleteAlert,
    setAlertEnabled,
    evaluateAlerts,
  }), [alerts, createAlert, deleteAlert, error, evaluateAlerts, isLoading, isRefreshing, refresh, setAlertEnabled, triggeredAlerts, updateAlert])
}
