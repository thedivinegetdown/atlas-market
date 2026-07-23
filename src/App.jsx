import { BrowserRouter, MemoryRouter } from 'react-router-dom'
import './App.css'
import { AppRoutes } from './AppRoutes.jsx'

const Router = typeof window === 'undefined' ? MemoryRouter : BrowserRouter

function App() {
  return (
    <Router>
      <AppRoutes />
    </Router>
  )
}

export default App
