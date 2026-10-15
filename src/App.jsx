import { BrowserRouter, MemoryRouter } from 'react-router-dom'
import './App.css'
import { AppRoutes } from './AppRoutes.jsx'
import { IdentityAuthBoundary, IdentityAuthProvider } from './auth/IdentityAuth.jsx'
import { useIdentityAuth } from './auth/identityAuthContext.js'
import { createMarketSessionIdentityKey } from './state/marketSessionState.js'
import { MarketSessionProvider } from './state/MarketSessionProvider.jsx'

const Router = typeof window === 'undefined' ? MemoryRouter : BrowserRouter

function AuthenticatedWorkspace() {
  const auth = useIdentityAuth()
  const identityKey = createMarketSessionIdentityKey(auth.user)
  return <MarketSessionProvider key={identityKey} identityKey={identityKey}><AppRoutes /></MarketSessionProvider>
}

function App() {
  return (
    <Router>
      <IdentityAuthProvider>
        <IdentityAuthBoundary>
          <AuthenticatedWorkspace />
        </IdentityAuthBoundary>
      </IdentityAuthProvider>
    </Router>
  )
}

export default App
