import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'MOBIL Retail - App del Asesor',
        short_name: 'MOBIL Retail',
        description: 'App de campo para visitas, inventario y reposición de retailers MOBIL',
        theme_color: '#0b1f3a',
        background_color: '#0b1f3a',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        // La app funciona offline: cachea el shell y deja que la cola de
        // sincronización (src/lib/offlineQueue.ts) maneje los datos.
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/rest/v1') || url.pathname.startsWith('/auth/v1'),
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
})
