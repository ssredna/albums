import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Spotify rejects "localhost" redirect URIs, so bind to the loopback IP.
export default defineConfig({
  plugins: [svelte()],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
});
