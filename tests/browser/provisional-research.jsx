import { createRoot } from 'react-dom/client'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import ResearchWorkspace from '../../src/workspaces/Research/ResearchWorkspace.jsx'
import { workspaceApiClient } from '../../src/api/workspaceApiClient.js'
import { researchOverview } from '../helpers/provisionalResearchFixtures.js'
import '../../src/index.css'
import '../../src/App.css'

// Local Vite-only acceptance fixture. Never contacts production or providers.
workspaceApiClient.getResearchHistory = async () => researchOverview()
workspaceApiClient.getGovernedReviewPreparationStatus = async () => ({ observationCoverage: { checks: [] } })
createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={['/research/AAPL']}><Routes><Route path="/research/:symbol" element={<ResearchWorkspace />} /></Routes></MemoryRouter>)
