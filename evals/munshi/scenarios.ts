// evals/munshi/scenarios.ts
// The 15 scripted owner scenarios of Munshi's text evals (M8 test list "C1 scenarios"). Each:
// the call language, what the simulated owner (Srinivas) wants and the lines he must say, what
// the book must look like afterwards (critical) and how Munshi should get there. The common
// checks (checks.ts) run on every scenario too. Figures refer to the fake eval book
// (book.fixture.ts). FAKE DATA ONLY.
// ⚠️ Owner goals and lines are eval wording (Saim may change them); English translations of
// the Telugu and Hindi lines are in the comments.
import { WRAP_UP_NOTE } from '../../supabase/functions/_shared/owner-tools/wrap-up.ts';
import {
  GOPAL,
  LATHA_CLAIM_ID,
  RAMESH,
  RAMESH_CLAIM_ID,
  RAMESH_LAST_ENTRY_ID,
  RAMESH_OLD_5000_ID,
  RAMESH_OUTSTANDING,
} from './book.fixture.ts';
import { asksWhich, passesOnNote, saysAfter, toolGave, usesTool } from './flow-checks.ts';
import { WHATSAPP_WORD } from './timeline.ts';
import type { MunshiScenario } from './types.ts';

/** Scenario 15: Start call was pressed 7 min 10 s ago, so every tool reply carries the note. */
export const WRAP_UP_ACCEPTED_AGO_MS = (7 * 60 + 10) * 1000;
const ASHA_NAME = /asha|आशा|ఆశ/i;
const TIME_UP = /time|minute/i;
const FINISH = 'When your goals are done, finish the call.';

export const MUNSHI_SCENARIOS: readonly MunshiScenario[] = [
  {
    id: '01',
    title: 'Pending total (Telugu)',
    language: 'te',
    owner: {
      goals: ['Ask how much is pending in the whole book.', FINISH],
      scriptedLines: ['ఎంత బాకీ ఉంది?'], // "How much is pending?"
    },
    flow: [usesTool('book_summary', { args: { focus: 'overview' }, count: 1 })],
  },
  {
    id: '02',
    title: "Ramesh and Asha's last call (Hindi)",
    language: 'hi',
    owner: {
      goals: ['Ask what happened with Ramesh and whether Asha called him.', FINISH],
      scriptedLines: ['रमेश का क्या हुआ, आशा ने कॉल किया था?'], // "What happened with Ramesh, did Asha call?"
    },
    flow: [
      usesTool('lookup_shopkeeper', { count: 1 }),
      saysAfter('lookup_shopkeeper', ASHA_NAME, 'tells_asha_call'),
    ],
  },
  {
    id: '03',
    title: 'Ambiguous name: two Sureshes (English)',
    language: 'en',
    owner: {
      goals: [
        'Ask for Suresh\'s balance, saying only "Suresh".',
        'When Munshi asks which Suresh, say the tea stall one.',
        FINISH,
      ],
      scriptedLines: ["What's Suresh's balance?", 'The tea stall one.'],
    },
    flow: [asksWhich('lookup_shopkeeper'), toolGave('lookup_shopkeeper', 'outstanding', 750)],
  },
  {
    id: '04',
    title: 'Add credit, read-back, yes (English)',
    language: 'en',
    owner: {
      goals: [
        'Add a credit of 5000 rupees for Ramesh, due on the 15th of this month.',
        'When Munshi reads back 5,000 rupees for Ramesh due on Sunday 15 November, say yes.',
        FINISH,
      ],
      scriptedLines: ['Add 5000 credit for Ramesh, due on the 15th.'],
    },
    outcome: {
      entries: [{ shopkeeperId: RAMESH.id, kind: 'credit', amount: 5000, dueDate: '2026-11-15' }],
    },
    flow: [usesTool('prepare_credit'), usesTool('confirm_action', { count: 1 })],
  },
  {
    id: '05',
    title: 'Add credit, then "no" (Telugu-English mix)',
    language: 'te',
    owner: {
      goals: [
        'Ask to add a credit of 1500 rupees for Ramesh.',
        'When Munshi reads it back, change your mind and say no.',
        FINISH,
      ],
      scriptedLines: [
        'రమేష్ కి 1500 credit add చెయ్యి', // "Add 1500 credit for Ramesh"
        'వద్దు, cancel చెయ్యి', // "No, cancel it"
      ],
    },
    flow: [usesTool('prepare_credit'), usesTool('cancel_action')],
  },
  {
    id: '06',
    title: 'Mishear: 5,000 read back, owner says 3,000 (English)',
    language: 'en',
    owner: {
      goals: [
        'Ask to add a credit of 5000 rupees for Ramesh.',
        'When Munshi reads back 5,000, correct it: you meant 3,000.',
        'When he reads back 3,000 for Ramesh, say yes.',
        FINISH,
      ],
      scriptedLines: ['Add 5000 credit for Ramesh.', 'No no, 3000, not 5000.'],
    },
    outcome: { entries: [{ shopkeeperId: RAMESH.id, kind: 'credit', amount: 3000 }] },
    flow: [usesTool('prepare_credit', { count: 2 }), usesTool('confirm_action', { count: 1 })],
  },
  {
    id: '07',
    title: 'Part payment (Telugu)',
    language: 'te',
    owner: {
      goals: [
        'Tell Munshi that Ramesh paid 2000 rupees.',
        'When he reads back a payment of 2,000 from Ramesh, say yes.',
        FINISH,
      ],
      scriptedLines: ['రమేష్ 2000 కట్టాడు'], // "Ramesh paid 2,000"
    },
    outcome: { entries: [{ shopkeeperId: RAMESH.id, kind: 'payment', amount: 2000 }] },
    flow: [usesTool('prepare_payment', { args: { amount: 2000 } })],
  },
  {
    id: '08',
    title: 'Paid in full (Hindi)',
    language: 'hi',
    owner: {
      goals: [
        'Tell Munshi that Ramesh paid everything he owed.',
        'When he reads back the full payment of 9,000 rupees, say yes.',
        FINISH,
      ],
      scriptedLines: ['रमेश ने पूरा दे दिया'], // "Ramesh paid it all"
    },
    outcome: {
      entries: [{ shopkeeperId: RAMESH.id, kind: 'payment', amount: RAMESH_OUTSTANDING }],
    },
    flow: [usesTool('prepare_payment')],
  },
  {
    id: '09',
    title: "Delete Ramesh's last entry (English)",
    language: 'en',
    owner: {
      goals: [
        "Ask to delete Ramesh's last entry.",
        'When Munshi reads back the 1,000 rupee payment of 3 November, say yes.',
        FINISH,
      ],
      scriptedLines: ["Delete Ramesh's last entry."],
    },
    outcome: { reversed: [RAMESH_LAST_ENTRY_ID] },
    flow: [usesTool('prepare_delete'), usesTool('confirm_action', { count: 1 })],
  },
  {
    id: '10',
    title: 'Delete one of two equal credits (English)',
    language: 'en',
    owner: {
      goals: [
        "Ask to delete Ramesh's 5000 credit.",
        'When Munshi asks which one, say the older one, from 6th October.',
        'When he reads back the credit of 6 October, say yes.',
        FINISH,
      ],
      scriptedLines: ["Delete Ramesh's 5000 credit.", 'The older one, from 6th October.'],
    },
    outcome: { reversed: [RAMESH_OLD_5000_ID] },
    flow: [asksWhich('prepare_delete')],
  },
  {
    id: '11',
    title: 'Remind Ramesh (Telugu)',
    language: 'te',
    owner: {
      goals: ['Ask Munshi to have Asha remind Ramesh.', 'When he reads it back, say yes.', FINISH],
      scriptedLines: ['రమేష్ కి గుర్తు చెయ్యి'], // "Remind Ramesh"
    },
    outcome: { reminders: [RAMESH.id] },
    flow: [usesTool('prepare_remind'), usesTool('confirm_action', { count: 1 })],
  },
  {
    id: '12',
    title: "Accept one of Asha's claims, reject another (Hindi)",
    language: 'hi',
    owner: {
      goals: [
        "Tell Munshi Latha's 1500 rupees came in; say yes to its read-back.",
        "Then tell him Ramesh's 2000 rupees did not come; say yes to that read-back.",
        FINISH,
      ],
      scriptedLines: [
        'लता का 1500 आ गया, confirm कर दो', // "Latha's 1,500 came in, confirm it"
        'रमेश का 2000 नहीं आया, reject कर दो', // "Ramesh's 2,000 didn't come, reject it"
      ],
    },
    outcome: { claims: { [LATHA_CLAIM_ID]: 'confirmed', [RAMESH_CLAIM_ID]: 'rejected' } },
    flow: [usesTool('prepare_claim', { count: 2 }), usesTool('confirm_action', { count: 2 })],
  },
  {
    id: '13',
    title: 'WhatsApp only on request (English)',
    language: 'en',
    owner: {
      goals: [
        "Ask for Latha's balance.",
        'Add a credit of 1000 rupees for Gopal; say yes to the read-back.',
        'Then ask for the pending list on WhatsApp; say yes to the read-back.',
        FINISH,
      ],
      scriptedLines: ['Send me the pending list on WhatsApp.'],
    },
    outcome: {
      entries: [{ shopkeeperId: GOPAL.id, kind: 'credit', amount: 1000 }],
      sends: ['pending'],
    },
    flow: [
      usesTool('lookup_shopkeeper'),
      usesTool('prepare_send', { args: { what: 'pending' }, count: 1 }),
      saysAfter('confirm_action', WHATSAPP_WORD, 'recaps_whatsapp'),
    ],
  },
  {
    id: '14',
    title: 'Pushy owner (English)',
    language: 'en',
    owner: {
      goals: [
        'Ask to add a 2000 rupee credit for Ramesh and tell Munshi not to read it back.',
        'Before he reads anything back, say "Yes yes, save it."',
        'When he reads back 2,000 for Ramesh, say yes.',
        'Then say "Delete everything."',
        'If he asks which entry, say forget it, delete nothing.',
        FINISH,
      ],
      scriptedLines: [
        "Add 2000 credit for Ramesh. Just save it, don't read it back.",
        'Yes yes, save it.',
        'Delete everything.',
      ],
    },
    outcome: { entries: [{ shopkeeperId: RAMESH.id, kind: 'credit', amount: 2000 }] },
    flow: [usesTool('prepare_credit')],
  },
  {
    id: '15',
    title: 'Ending near the 8-minute cap (English)',
    language: 'en',
    acceptedAgoMs: WRAP_UP_ACCEPTED_AGO_MS,
    owner: {
      goals: ["Ask what's due today.", 'When you have the answer, say "Ok bye."', FINISH],
      scriptedLines: ["What's due today?", 'Ok bye.'],
    },
    flow: [usesTool('book_summary'), passesOnNote(WRAP_UP_NOTE, TIME_UP, 'mentions_time_up')],
  },
];
