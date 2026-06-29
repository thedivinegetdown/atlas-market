export function createKillSwitchEngine(initialState = false) {
  let active = initialState

  return {
    isActive() {
      return active
    },
    activate() {
      active = true
      return active
    },
    deactivate() {
      active = false
      return active
    },
    toggle() {
      active = !active
      return active
    },
  }
}
