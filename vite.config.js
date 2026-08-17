import { defineConfig } from 'vite'

// Capacitor serves the built web app from its own local origin, so a relative
// base keeps asset paths working inside the Android WebView.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2019'
  },
  server: {
    port: 5173
  }
})
