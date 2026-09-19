import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './src/manifest.json';

export default defineConfig(({ mode }) => {
  const extensionEnv = loadEnv(mode, process.cwd(), '');
  const webEnv = loadEnv(mode, resolve(__dirname, '../web'), '');

  return {
  plugins: [react(), crx({ manifest })],
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(extensionEnv.VITE_SUPABASE_URL ?? webEnv.NEXT_PUBLIC_SUPABASE_URL ?? ''),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(extensionEnv.VITE_SUPABASE_ANON_KEY ?? webEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022',
    rollupOptions: {
      input: {
        popup: 'index.html',
        options: 'options.html',
      },
    },
  },
  server: {
    port: 5173,
  },
  };
});
