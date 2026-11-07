// scripts/brand-png.ts
// npm run brand:png — renders the logo SVG (web/public/brand/logo.svg) to the 640×640 PNG used as
// the bot's WhatsApp profile photo (M7 Decision 5). @resvg/resvg-js is a pinned devDependency
// used only here: never in the web bundle or the Edge Functions. The SVG has no text, so the
// output does not depend on the fonts of the machine.
import { readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { LOGO_SIZE, logoProblem } from './lib/bot-profile.ts';

const SVG_PATH = 'web/public/brand/logo.svg';
const PNG_PATH = 'web/public/brand/logo-640.png';

const svg = readFileSync(SVG_PATH, 'utf8');
const png = new Resvg(svg, { fitTo: { mode: 'width', value: LOGO_SIZE } }).render().asPng();
const problem = logoProblem(new Uint8Array(png));
if (problem) {
  process.stdout.write(`FAIL ${problem}\n`);
  process.exitCode = 1;
} else {
  writeFileSync(PNG_PATH, png);
  process.stdout.write(`ok   ${PNG_PATH} (${png.byteLength} bytes, ${LOGO_SIZE}×${LOGO_SIZE})\n`);
}
