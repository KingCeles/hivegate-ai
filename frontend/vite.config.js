import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('recharts') || id.includes('d3-')) {
            return 'chart-vendor'
          }
          if (id.includes('framer-motion')) {
            return 'motion-vendor'
          }
          if (
            id.includes('/node_modules/react/')
            || id.includes('/node_modules/react-dom/')
            || id.includes('/node_modules/react-router-dom/')
            || id.includes('\\node_modules\\react\\')
            || id.includes('\\node_modules\\react-dom\\')
            || id.includes('\\node_modules\\react-router-dom\\')
          ) {
            return 'react-vendor'
          }
          if (id.includes('axios')) {
            return 'http-vendor'
          }
          return undefined
        }
      }
    }
  },
  server: {
    allowedHosts: [
      'commerce-router-facility-pine.trycloudflare.com',
      '.trycloudflare.com'
    ],
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true
      },
      '/motion-api': {
        target: 'http://localhost:5001',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/motion-api/, '')
      }
    }
  }
})
