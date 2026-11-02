// scripts/seed/write-seed.ts
// npm run seed:generate → regenerates supabase/seed.sql from the fixed random seed.
import { writeFileSync } from 'node:fs';
import { generateSeed } from './generate-seed.ts';
import { renderSeedSql } from './render-sql.ts';

export const SEED_FILE = 'supabase/seed.sql';

const data = generateSeed();
writeFileSync(SEED_FILE, renderSeedSql(data));
process.stdout.write(
  `Wrote ${SEED_FILE}: ${data.shopkeepers.length} shopkeepers, ${data.entries.length} ledger ` +
    `entries, ${data.promises.length} promises.\n`,
);
