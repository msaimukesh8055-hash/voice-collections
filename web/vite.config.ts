// web/vite.config.ts
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { devDashboardToken } from './dev/devDashboardToken.ts';

const sharedDir = fileURLToPath(new URL('../supabase/functions/_shared', import.meta.url));
const voiceAgentsDir = fileURLToPath(new URL('../voice-agents', import.meta.url));
const envDir = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig(function config({ mode }) {
  // Server-side only: read without the VITE_ prefix, so it never reaches the browser bundle.
  const devSecret = loadEnv(mode, envDir, '')['DASHBOARD_LINK_SECRET'];
  return {
    // devDashboardToken exists only for `vite` (dev serve), never in build or preview.
    plugins: [react(), tailwindcss(), devDashboardToken(devSecret)],
    // Read VITE_* vars from the repo-root .env (single env file for the whole project).
    envDir: '..',
    resolve: { alias: { '@shared': sharedDir, '@voice-agents': voiceAgentsDir } },
    // Test coverage reports must not trigger page reloads (a reload drops a live call).
    // No `host`: the dev server stays bound to localhost.
    server: { watch: { ignored: ['**/coverage/**'] } },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./vitest.setup.ts'],
      coverage: {
        provider: 'v8',
        include: ['src/**/*.{ts,tsx}', 'dev/**/*.ts'],
        exclude: ['src/main.tsx', 'src/lib/sarvamBrowser.ts', 'src/test/**'],
      },
    },
  };
});
