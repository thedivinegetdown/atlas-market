import { createRecord, deleteRecord, findRecord, listRecords, updateRecord } from './store.js'

export function createScannerRepository() {
  return {
    create(data) {
      return createRecord('scanners', {
        type: 'scanner',
        ...data,
      })
    },

    update(id, updater) {
      return updateRecord('scanners', id, updater)
    },

    delete(id) {
      return deleteRecord('scanners', id)
    },

    list() {
      return listRecords('scanners')
    },

    find(id) {
      return findRecord('scanners', id)
    },

    setEnabled(id, enabled) {
      return updateRecord('scanners', id, () => ({ enabled: Boolean(enabled) }))
    },
  }
}
