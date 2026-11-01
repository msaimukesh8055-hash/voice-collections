// vitest.config.ts
// Root test runner for agent configs and scripts (Node). The dashboard has its own config in web/.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['agent/**/*.test.ts', 'scripts/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['agent/**/*.ts', 'scripts/lib/**/*.ts'],
      exclude: ['**/*.test.ts'],
      reportsDirectory: 'coverage/root',
    },
  },
});
