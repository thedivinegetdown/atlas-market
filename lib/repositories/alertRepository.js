import { createRecord, deleteRecord, findRecord, listRecords, updateRecord } from './store.js'

export function createAlertRepository() {
  return {
    create(data) {
      return createRecord('alerts', {
        type: 'alert',
        ...data,
      })
    },

    update(id, updater) {
      return updateRecord('alerts', id, updater)
    },

    delete(id) {
      return deleteRecord('alerts', id)
    },

    list() {
      return listRecords('alerts')
    },

    find(id) {
      return findRecord('alerts', id)
    },

    setEnabled(id, enabled) {
      return updateRecord('alerts', id, () => ({ enabled: Boolean(enabled) }))
    },
  }
}
