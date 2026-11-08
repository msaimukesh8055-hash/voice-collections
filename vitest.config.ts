// vitest.config.ts
// Root test runner for agent configs, scripts and evals (Node). The dashboard has its own config in web/.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['voice-agents/**/*.test.ts', 'scripts/**/*.test.ts', 'evals/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: [
        'voice-agents/**/*.ts',
        'scripts/lib/**/*.ts',
        'scripts/seed/**/*.ts',
        'evals/**/*.ts',
      ],
      // CLI entry points (argument parsing + process exit); their logic is in tested modules.
      exclude: ['**/*.test.ts', 'scripts/seed/write-seed.ts', 'evals/munshi/run.ts'],
      reportsDirectory: 'coverage/root',
    },
  },
});
