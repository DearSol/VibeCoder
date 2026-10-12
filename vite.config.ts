import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { createAiService } from './server/ai.ts';

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    {
      name: 'expand-local-ai',
      configureServer(server) {
        const ai = createAiService({ ...loadEnv(mode, process.cwd(), ''), ...process.env });
        server.middlewares.use((request, response, next) => {
          void ai.handle(request, response, next);
        });
        server.httpServer?.once('close', ai.close);
      },
    },
  ],
  clearScreen: false,
  server: { host: '127.0.0.1', port: 1420, strictPort: true },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: { target: 'es2022' },
  test: { include: ['src/**/*.test.ts', 'server/**/*.test.ts'], environment: 'node' },
}));
