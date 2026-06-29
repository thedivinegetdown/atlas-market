import { createRecord, findRecord, listRecords, updateRecord } from './store.js'

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

    list() {
      return listRecords('alerts')
    },

    find(id) {
      return findRecord('alerts', id)
    },
  }
}
