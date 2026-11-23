// web/vitest.setup.ts
import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';

// The full gate runs the suite with coverage while other checks run; a page test's first
// render can then take over a second. findBy* waits up to 3 s instead of 1 s, so a slow
// machine is not reported as a broken page (seen 2026-11-23: 6 page tests timing out).
configure({ asyncUtilTimeout: 3_000 });
