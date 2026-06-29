export function createErrorContract(code, message, details = null) {
  return Object.freeze({
    ok: false,
    code,
    message,
    details,
  })
}

export function createSuccessContract(data = null) {
  return Object.freeze({
    ok: true,
    data,
  })
}

export function isErrorContract(value) {
  return Boolean(value) && value.ok === false && typeof value.code === 'string'
}
