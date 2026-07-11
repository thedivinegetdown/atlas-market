import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
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
              test: /src[\\/]core[\\/](risk|execution|accounting|journal|ai)[\\/]/,
            },
            {
              name: 'compliance-system',
              test: /lib[\\/]system[\\/]compliance/,
            },
            {
              name: 'market-research-system',
              test: /lib[\\/](market|research|signals|system|brokers|assets)[\\/]/,
            },
          ],
        },
      },
    },
  },
})
