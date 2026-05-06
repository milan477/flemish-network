import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('leaflet') || id.includes('react-leaflet')) return 'map-vendor';
            if (id.includes('xlsx')) return 'xlsx-vendor';
            if (id.includes('@supabase')) return 'supabase-vendor';
            if (id.includes('react') || id.includes('react-router-dom')) return 'react-vendor';
            if (id.includes('lucide-react')) return 'icons-vendor';
          }
        },
      },
    },
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
});
