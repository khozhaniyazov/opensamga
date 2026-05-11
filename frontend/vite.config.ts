import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'

export default defineConfig({
  base: process.env.VITE_CDN_URL || '/',
  plugins: [
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
    visualizer({
      open: false,
      filename: 'dist/stats.html',
      gzipSize: true,
      brotliSize: true,
      template: 'treemap',
    }),
  ],
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    // Agent harness: shifted off prod's 5173 so both stacks can run side-by-side.
    port: 5174,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8001",
        changeOrigin: true,
        ws: true,
      },
      "/static": {
        target: "http://127.0.0.1:8001",
        changeOrigin: true,
      },
    },
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],

  build: {
    // Target modern browsers for smaller output
    target: 'es2020',

    // Enable source maps for production debugging
    sourcemap: true,

    rollupOptions: {
      output: {
        // Split only the heavy, well-known libraries. Avoid a catch-all
        // "vendor" bucket: it can create Rollup cycles when a generic
        // vendor chunk and a framework chunk import each other.
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return;
          }

          const normalized = id.replace(/\\/g, '/');

          if (
            normalized.includes('/node_modules/react/') ||
            normalized.includes('/node_modules/react-dom/') ||
            normalized.includes('/node_modules/scheduler/')
          ) {
            return 'react-core';
          }
          if (
            normalized.includes('/node_modules/react-router') ||
            normalized.includes('/node_modules/@tanstack/react-query') ||
            normalized.includes('/node_modules/react-error-boundary')
          ) {
            return 'react-app';
          }
          if (
            normalized.includes('/node_modules/recharts') ||
            normalized.includes('/node_modules/d3-')
          ) {
            return 'charts-vendor';
          }
          if (
            normalized.includes('/node_modules/i18next') ||
            normalized.includes('/node_modules/react-i18next')
          ) {
            return 'i18n-vendor';
          }
          if (normalized.includes('/node_modules/lucide-react')) {
            return 'icons-vendor';
          }
          if (normalized.includes('/node_modules/katex')) {
            return 'math-vendor';
          }
          if (
            normalized.includes('/node_modules/react-markdown') ||
            normalized.includes('/node_modules/remark-') ||
            normalized.includes('/node_modules/rehype-') ||
            normalized.includes('/node_modules/unified') ||
            normalized.includes('/node_modules/micromark') ||
            normalized.includes('/node_modules/mdast-') ||
            normalized.includes('/node_modules/hast-') ||
            normalized.includes('/node_modules/unist-') ||
            normalized.includes('/node_modules/vfile') ||
            normalized.includes('/node_modules/property-information') ||
            normalized.includes('/node_modules/space-separated-tokens') ||
            normalized.includes('/node_modules/comma-separated-tokens') ||
            normalized.includes('/node_modules/markdown-table') ||
            normalized.includes('/node_modules/character-entities') ||
            normalized.includes('/node_modules/decode-named-character-reference') ||
            normalized.includes('/node_modules/trim-lines') ||
            normalized.includes('/node_modules/trough') ||
            normalized.includes('/node_modules/bail') ||
            normalized.includes('/node_modules/devlop')
          ) {
            return 'markdown-vendor';
          }
          if (
            normalized.includes('/node_modules/axios') ||
            normalized.includes('/node_modules/axios-retry')
          ) {
            return 'http-vendor';
          }
        },
        // Consistent hashed filenames for cache busting
        chunkFileNames: 'assets/js/[name]-[hash].js',
        entryFileNames: 'assets/js/[name]-[hash].js',
        assetFileNames: 'assets/[ext]/[name]-[hash].[ext]',
      },
    },

    // Chunk size warning threshold (kB)
    chunkSizeWarningLimit: 500,
  },
})
