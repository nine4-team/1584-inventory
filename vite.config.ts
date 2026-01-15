import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { VitePWA } from 'vite-plugin-pwa'
import fs from 'fs'

// Quick build-time visibility into Vite env vars (removed after debugging)
console.log('🔍 BUILD ENV:', {
  url: process.env.VITE_SUPABASE_URL ? `${process.env.VITE_SUPABASE_URL.slice(0, 20)}…` : 'undefined',
  key: process.env.VITE_SUPABASE_ANON_KEY ? `${process.env.VITE_SUPABASE_ANON_KEY.slice(0, 20)}…` : 'undefined'
})

// Generate a timestamp for cache busting
const timestamp = Date.now()

// Plugin to inject build timestamp into ping.json
const pingTimestampPlugin = () => {
  return {
    name: 'ping-timestamp',
    buildStart() {
      const pingPath = path.resolve(__dirname, 'public/ping.json')
      if (fs.existsSync(pingPath)) {
        const content = JSON.parse(fs.readFileSync(pingPath, 'utf-8'))
        content.timestamp = new Date().toISOString()
        fs.writeFileSync(pingPath, JSON.stringify(content, null, 2))
      }
    }
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    pingTimestampPlugin(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'public',
      filename: 'sw-custom.js',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest,json}'],
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024
      },
      // Registration handled manually via virtual:pwa-register helper
      registerType: 'autoUpdate',
      injectRegister: null,
      devOptions: {
        enabled: true,
        type: 'module'
      },
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg', 'index.html'],
      manifest: {
        name: '1584 Design Inventory & Transactions',
        short_name: '1584 Design Projects',
        description: 'Modern, mobile-first inventory management system',
        theme_color: '#0ea5e9',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait-primary',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: '/icon-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable any'
          },
          {
            src: '/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable any'
          }
        ]
      },
      // PWA enabled in both dev and prod for consistent behavior
      // Use short cache times to ensure changes are visible immediately
    })
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    host: true,
    https: false, // Set to true if you want HTTPS in development
    cors: true,   // Enable CORS for development
    // Enable localStorage for auth persistence - no cache control headers that interfere
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          supabase: ['@supabase/supabase-js'],
          router: ['react-router-dom'],
          ui: ['lucide-react', 'clsx']
        },
        // Ensure proper MIME types
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]'
      }
    }
  }
})
