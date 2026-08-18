import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The express server already serves app/public statically (server.js:654), so
// building there means zero server changes for the client swap. The previous
// vanilla client now lives in app/legacy and is served at /legacy.
export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: {
    outDir: '../public',
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5173,
    // `npm run dev` gives HMR while proxying the API + websocket to the
    // real server on :3000, so the duel engine is live during UI work.
    proxy: {
      '/api': 'http://localhost:3000',
      '/figures': 'http://localhost:3000',
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
});
