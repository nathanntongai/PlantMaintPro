import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    chyunkSizeWarningLimit: 6400,
  },
    server: {
    host: true, 
    allowedHosts: [
      // Allow any subdomain of loca.lt
      '.loca.lt',
    ]
  }
})