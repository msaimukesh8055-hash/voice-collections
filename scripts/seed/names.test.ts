// scripts/seed/names.test.ts
// Every fake person the seed can create has an explicit face on the call screen (M7 B2).
import { describe, expect, it } from 'vitest';
import { FIRST_NAME_GENDER } from '../../supabase/functions/_shared/gender.ts';
import { FIRST_NAMES, OWNER, RAMESH } from './names.ts';

describe('seed names › gender list', () => {
  it('lists every seed first name, Ramesh and the owner', () => {
    const all = [...Object.values(FIRST_NAMES).flat(), RAMESH.name, OWNER.name.split(' ')[0] ?? ''];
    const missing = all.filter((name) => !FIRST_NAME_GENDER.has(name.toLowerCase()));
    expect(missing).toEqual([]);
  });

  it('gives Ramesh and Srinivas the male face', () => {
    expect(FIRST_NAME_GENDER.get('ramesh')).toBe('male');
    expect(FIRST_NAME_GENDER.get('srinivas')).toBe('male');
  });
});
