export const ERROR_CODES = Object.freeze({
  INTERNAL_ERROR: 'internal_error',
  INVALID_JSON: 'invalid_json',
  METHOD_NOT_ALLOWED: 'method_not_allowed',
  VALIDATION_ERROR: 'validation_error',
  MISSING_CONFIG: 'missing_config',
})

const defaultPublicMessages = Object.freeze({
  [ERROR_CODES.INTERNAL_ERROR]: 'request failed',
  [ERROR_CODES.INVALID_JSON]: 'request body must be valid JSON',
  [ERROR_CODES.METHOD_NOT_ALLOWED]: 'method is not allowed',
  [ERROR_CODES.VALIDATION_ERROR]: 'request validation failed',
  [ERROR_CODES.MISSING_CONFIG]: 'required configuration is missing',
})

export class AppError extends Error {
  constructor(code, message, {
    statusCode = 500,
    publicMessage,
    metadata = {},
    cause,
  } = {}) {
    super(message, { cause })
    this.name = 'AppError'
    this.code = code
    this.statusCode = statusCode
    this.publicMessage = publicMessage ?? defaultPublicMessages[code] ?? 'request failed'
    this.metadata = metadata
  }
}

export function isAppError(error) {
  return error instanceof AppError
}

export function toPublicError(error, fallbackCode = ERROR_CODES.INTERNAL_ERROR) {
  if (isAppError(error)) {
    return {
      statusCode: error.statusCode,
      code: error.code,
      message: error.publicMessage,
    }
  }

  if (error?.ok === false && error?.error) {
    return {
      statusCode: error.statusCode ?? 400,
      code: error.error.code ?? fallbackCode,
      message: error.error.message ?? defaultPublicMessages[fallbackCode],
    }
  }

  return {
    statusCode: 500,
    code: fallbackCode,
    message: defaultPublicMessages[fallbackCode],
  }
}
