// supabase/functions/_shared/gender.ts
// Which face the call screen draws for a person (M7 B2, Saim's Decision 1). The book has no
// gender column, so this is an explicit list of the seed's FAKE first names (scripts/seed/names.ts
// is checked against it by a test). A name that is not on the list, or one used by women and men
// alike, gets the neutral face: nothing is guessed from how a name sounds.

export type Gender = 'female' | 'male' | 'neutral';

const FEMALE = [
  'Lakshmi',
  'Padma',
  'Sujatha',
  'Kavitha',
  'Sridevi',
  'Saritha',
  'Vani',
  'Radha',
  'Jyothi',
  'Swapna',
  'Usha',
  'Aruna',
  'Bharathi',
  'Hema',
  'Latha',
  'Manjula',
  'Nirmala',
  'Pushpa',
  'Rekha',
  'Shanthi',
  'Vasantha',
  'Ayesha',
  'Nazia',
  'Mary',
  'Grace',
] as const;

const MALE = [
  'Srinivas',
  'Ramesh',
  'Suresh',
  'Venkatesh',
  'Naresh',
  'Mahesh',
  'Ravi',
  'Prasad',
  'Nagaraju',
  'Raju',
  'Krishna',
  'Gopal',
  'Murali',
  'Siva',
  'Bhaskar',
  'Lokesh',
  'Harish',
  'Praveen',
  'Anil',
  'Sunil',
  'Vijay',
  'Mohan',
  'Ramana',
  'Obulesu',
  'Narasimha',
  'Hanumanth',
  'Pullaiah',
  'Eswar',
  'Balaji',
  'Chinna',
  'Imran',
  'Salim',
  'Rakesh',
  'Sanjay',
  'Farooq',
  'Mukesh',
  'Deepak',
  'Rafiq',
  'Joseph',
  'Thomas',
  'David',
  'Paul',
] as const;

/** Names given to women and men alike in the seed's languages: the neutral face, on purpose. */
const EITHER = ['Kiran', 'Sai', 'Madhu', 'Chandra'] as const;

function entries(names: readonly string[], gender: Gender): [string, Gender][] {
  return names.map((name): [string, Gender] => [name.toLowerCase(), gender]);
}

/** Every listed first name (lower case) → its face. */
export const FIRST_NAME_GENDER: ReadonlyMap<string, Gender> = new Map([
  ...entries(FEMALE, 'female'),
  ...entries(MALE, 'male'),
  ...entries(EITHER, 'neutral'),
]);

/** The face for a full name ("Radha", "Srinivas Reddy"): its first word, else neutral. */
export function genderOf(name: string): Gender {
  const first = name.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  return FIRST_NAME_GENDER.get(first) ?? 'neutral';
}
