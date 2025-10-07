import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, 
    allowedHosts: [
      // Allow any subdomain of loca.lt
      '.loca.lt',
    ]
  }
})