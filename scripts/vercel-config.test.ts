// scripts/vercel-config.test.ts
// vercel.json serves the single-page app: every page path gets index.html (never cached), hashed
// assets are cached for a year and never rewritten, and every response carries the security
// headers. Vercel sources here are plain regular expressions, so they are checked as such.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const HeaderSchema = z.object({ key: z.string(), value: z.string() });
const VercelConfigSchema = z.object({
  framework: z.string(),
  installCommand: z.string(),
  buildCommand: z.string(),
  outputDirectory: z.string(),
  rewrites: z.array(z.object({ source: z.string(), destination: z.string() })),
  headers: z.array(z.object({ source: z.string(), headers: z.array(HeaderSchema) })),
});

const config = VercelConfigSchema.parse(
  JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')),
);
const rootScripts = z
  .object({ scripts: z.record(z.string(), z.string()) })
  .parse(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))).scripts;

const PAGE_PATHS = [
  '/',
  '/phone',
  '/phone/',
  '/munshi',
  '/shopkeepers',
  '/calls',
  '/anything/else',
];
const ASSET_PATH = '/assets/index-AbC123.js';

function matches(source: string, path: string): boolean {
  return new RegExp(`^${source}$`).test(path);
}

function rewriteFor(path: string): string | null {
  return config.rewrites.find((rule) => matches(rule.source, path))?.destination ?? null;
}

/** The headers Vercel sends for a path: every matching rule applies (no two set the same key). */
function headersFor(path: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const rule of config.headers.filter((entry) => matches(entry.source, path))) {
    for (const header of rule.headers) result.set(header.key.toLowerCase(), header.value);
  }
  return result;
}

describe('vercel.json build', () => {
  it('installs from the lockfile and builds the web workspace into web/dist', () => {
    expect([config.installCommand, config.outputDirectory]).toEqual(['npm ci', 'web/dist']);
    expect(rootScripts[config.buildCommand.replace(/^npm run /, '')]).toBe('npm run build -w web');
  });
});

describe('vercel.json rewrites', () => {
  it.each(PAGE_PATHS)('serves index.html for %s', (path) => {
    expect(rewriteFor(path)).toBe('/index.html');
  });

  it('never rewrites a missing asset to index.html (a stale chunk must 404, not load HTML)', () => {
    expect(rewriteFor(ASSET_PATH)).toBeNull();
  });
});

describe('vercel.json headers', () => {
  it.each([...PAGE_PATHS, ASSET_PATH])('sends the security headers on %s', (path) => {
    const headers = headersFor(path);

    expect(headers.get('x-content-type-options')).toBe('nosniff');
    expect(headers.get('referrer-policy')).toBe('no-referrer');
    expect([headers.get('x-frame-options'), headers.get('content-security-policy')]).toEqual([
      'DENY',
      "frame-ancestors 'none'",
    ]);
  });

  it('lets this site, and only this site, use the microphone (the phone page needs it)', () => {
    expect(headersFor('/phone').get('permissions-policy')).toMatch(/(^|, )microphone=\(self\)/);
  });

  it('caches hashed assets for a year', () => {
    expect(headersFor(ASSET_PATH).get('cache-control')).toBe('public, max-age=31536000, immutable');
  });

  it.each(PAGE_PATHS)('revalidates index.html on every visit to %s', (path) => {
    expect(headersFor(path).get('cache-control')).toBe('no-cache');
  });
});
