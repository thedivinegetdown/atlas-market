import { createContext, useContext } from 'react'

export const IdentityAuthContext = createContext(null)

export function useIdentityAuth() {
  const context = useContext(IdentityAuthContext)
  if (!context) throw new Error('IdentityAuthProvider is required')
  return context
}
