// web/vite.config.ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const sharedDir = fileURLToPath(new URL('../supabase/functions/_shared', import.meta.url));
const voiceAgentsDir = fileURLToPath(new URL('../voice-agents', import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Read VITE_* vars from the repo-root .env (single env file for the whole project).
  envDir: '..',
  resolve: { alias: { '@shared': sharedDir, '@voice-agents': voiceAgentsDir } },
  // Test coverage reports must not trigger page reloads (a reload drops a live call).
  server: { watch: { ignored: ['**/coverage/**'] } },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/main.tsx', 'src/lib/sarvamBrowser.ts', 'src/test/**'],
    },
  },
});
