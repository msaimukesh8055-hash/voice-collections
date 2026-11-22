// supabase/functions/_shared/evals/case-fixes.ts
// "How it got fixed" (Saim, 2026-11-22): one plain-English line per fixed test case saying what
// made it pass, shown first in that case's before / after view. Drafted by Claude on 2026-11-22
// from the run notes, docs/BUILD-LOG.md and the prompt changes; the wording is Saim's to approve.
// Keyed "<target>:<case id>". A case with no line here shows only the run's note.

const TEST_RIG =
  'Not a Munshi change: our test rig was fixed. In the first run Sarvam queued the calls past the 10-minute limit, so every test call link had expired.';

export const CASE_FIXES: Readonly<Record<string, string>> = {
  // Asha
  'asha:asha-02':
    'Prompt v9 says one thing per turn, so the part payment is read back on its own instead of getting lost in a long reply.',
  'asha:asha-03':
    'Prompt v9 says one thing per turn: when they say they already paid, Asha asks the amount, date and how they paid, then records the claim.',
  'asha:asha-04':
    'Prompt v9: a broken promise is raised first, in one short turn, before Asha logs a new one.',
  'asha:asha-05':
    'Prompt v9: no words in the same reply as a tool call, so Asha no longer runs everything into one long turn.',
  'asha:asha-06':
    'Prompt v9: words said alongside a tool call were never spoken, which is how "the owner will call back" went missing. Asha now calls the tool silently and says it after.',
  'asha:asha-07':
    'Prompt v7: when someone else answers, Asha records "identity denied" and shares nothing about money.',
  'asha:asha-08':
    'Prompt v9: Asha records who she is speaking to first, then offers the owner’s call back, even when the caller is angry.',
  'asha:asha-09':
    'Prompt v8: Asha confirms who she is speaking to before anything else, so an unverified "clear my balance" gets nowhere.',
  // WhatsApp brain (checked in code)
  'brain:brain-10':
    'Our parser fixed: "X gave me N" is now read as a payment to the owner, not new credit.',
  'brain:brain-19':
    'A code guard after the AI: a promise to pay later never becomes a money card, whatever the AI suggests.',
  // Munshi
  'munshi:munshi-01': TEST_RIG,
  'munshi:munshi-02':
    'Our test fixed: in one run the simulated owner asked for something else; the case now only asks its question.',
  'munshi:munshi-03': TEST_RIG,
  'munshi:munshi-04': TEST_RIG,
  'munshi:munshi-05': TEST_RIG,
  'munshi:munshi-06': TEST_RIG,
  'munshi:munshi-07':
    'Prompt v3: Munshi confirms on its own, never together with another tool, so the part payment is no longer lost.',
  'munshi:munshi-08': TEST_RIG,
  'munshi:munshi-09': TEST_RIG,
  'munshi:munshi-10': TEST_RIG,
  'munshi:munshi-11':
    'Server fix: a new read-back waits 1.5 s, so a confirm Munshi sends at the same moment still saves first.',
  'munshi:munshi-12':
    'Server fix: a new read-back waits 1.5 s, so a confirm Munshi sends at the same moment still saves first.',
  'munshi:munshi-13':
    'Server fix: a new read-back waits 1.5 s, so a confirm Munshi sends at the same moment still saves first.',
  'munshi:munshi-14': TEST_RIG,
  'munshi:munshi-15':
    'Our test rig fixed: call time now comes from the database server (this PC’s clock was 4 minutes slow).',
  'munshi:munshi-16': TEST_RIG,
};
