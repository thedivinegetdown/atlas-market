import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 505,
    modulePreload: {
      resolveDependencies(_filename, dependencies) {
        return dependencies.filter((dependency) => !/(atlas-ai-panels|release-diagnostics-ui)-/.test(dependency))
      },
    },
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'react-vendor',
              test: /node_modules[\\/](react|react-dom)[\\/]/,
            },
            {
              name: 'analytics-engines',
              test: /src[\\/]core[\\/]analytics[\\/]/,
            },
            {
              name: 'strategy-engines',
              test: /src[\\/]core[\\/]strategy[\\/]/,
            },
            {
              name: 'risk-execution-engines',
              test: /(src[\\/]core[\\/](risk|execution|accounting|journal|ai)|lib[\\/]trading)[\\/]/,
            },
            {
              name: 'charting-system',
              test: /lib[\\/]system[\\/]institutionalChart/,
            },
            {
              name: 'compliance-system',
              test: /lib[\\/]system[\\/]compliance/,
            },
            {
              name: 'market-data-system',
              test: /lib[\\/](market|scanners)[\\/]/,
            },
            {
              name: 'reporting-system',
              test: /lib[\\/]reports[\\/]/,
            },
            {
              name: 'release-diagnostics-ui',
              test: /src[\\/]components[\\/]ReleaseDiagnosticsPanel/,
            },
            {
              name: 'atlas-ai-panels',
              test: /src[\\/]components[\\/](AtlasCopilotPanel|AtlasOpportunityReviewPanel|AtlasPortfolioIntelligencePanel)/,
            },
            {
              name: 'atlas-ai-core',
              test: /(lib[\\/]ai[\\/]|lib[\\/]portfolio[\\/]portfolioIntelligenceEngine)/,
            },
            {
              name: 'system-operations',
              test: /lib[\\/]system[\\/](?!compliance|institutionalChart)/,
            },
            {
              name: 'market-research-system',
              test: /lib[\\/](research|signals|brokers|assets)[\\/]/,
            },
          ],
        },
      },
    },
  },
})
