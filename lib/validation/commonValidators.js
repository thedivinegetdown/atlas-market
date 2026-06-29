import { createErrorContract } from './errorContract.js'

export function validateRequired(value, fieldName) {
  if (value === null || value === undefined || value === '') {
    return createErrorContract('required', `${fieldName} is required`)
  }

  return null
}

export function validateNumber(value, fieldName) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return createErrorContract('invalid_number', `${fieldName} must be a valid number`)
  }

  return null
}

export function validatePositiveNumber(value, fieldName) {
  const numberError = validateNumber(value, fieldName)
  if (numberError) {
    return numberError
  }

  if (value <= 0) {
    return createErrorContract('invalid_number', `${fieldName} must be greater than zero`)
  }

  return null
}
