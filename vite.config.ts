import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        // Cache app shell (HTML, CSS, JS)
        globPatterns: ['**/*.{js,css,html,svg,png,woff,woff2}'],
        // Runtime caching for Pyodide CDN files
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/pyodide\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'pyodide-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
      manifest: false, // We provide our own manifest.json in public/
    }),
  ],
  base: '/',
  build: {
    sourcemap: true,
  },
})
