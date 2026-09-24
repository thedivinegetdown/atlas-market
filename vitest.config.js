import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    maxWorkers: 2,
    pool: 'threads',
    exclude: [...configDefaults.exclude, '**/.ci-divergence/**', '**/.ci-runtime/**'],
    setupFiles: ['./src/test/setup.js'],
  },
})
