import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // The project keeps one .env at the repository root. Only VITE_* values reach the browser.
  const env = loadEnv(mode, '..', 'VITE_');
  return {
    envDir: '..',
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': {
          target: env.VITE_DEV_API_PROXY || 'http://localhost:4000',
          changeOrigin: false,
        },
      },
    },
    build: {
      sourcemap: false,
      chunkSizeWarningLimit: 900,
    },
  };
});
