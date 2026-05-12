import { defineConfig } from 'vite';
import path from 'path';

const backendPort = process.env.BACKEND_PORT || process.env.PORT || '3000';
const backendTarget = process.env.BACKEND_URL || `http://127.0.0.1:${backendPort}`;
const rawBasePath = process.env.VITE_BASE_PATH || '/cp/';
const basePath = `/${rawBasePath.replace(/^\/|\/$/g, '')}/`.replace(/^\/\/$/, '/');

export default defineConfig({
  root: '.',
  base: basePath,
  publicDir: 'public',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/ws': {
        target: backendTarget,
        ws: true,
      },
      '/cp/ws': {
        target: backendTarget,
        ws: true,
      },
      '/api': {
        target: backendTarget,
      },
      '/cp/api': {
        target: backendTarget,
      },
    },
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
});
