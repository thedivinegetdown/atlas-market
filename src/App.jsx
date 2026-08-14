import { BrowserRouter, MemoryRouter } from 'react-router-dom'
import './App.css'
import { AppRoutes } from './AppRoutes.jsx'
import { IdentityAuthBoundary, IdentityAuthProvider } from './auth/IdentityAuth.jsx'

const Router = typeof window === 'undefined' ? MemoryRouter : BrowserRouter

function App() {
  return (
    <Router>
      <IdentityAuthProvider>
        <IdentityAuthBoundary>
          <AppRoutes />
        </IdentityAuthBoundary>
      </IdentityAuthProvider>
    </Router>
  )
}

export default App
