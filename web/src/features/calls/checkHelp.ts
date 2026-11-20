// web/src/features/calls/checkHelp.ts
// Plain-English help for every scorecard check (Saim, 2026-11-20: "or else it's confusing"),
// shown under the check on the call pages and on Agent health. `means` says what the check looks
// at; `miss` says what a fail or warning means for the business, and when the check itself can be
// wrong (most "said / not said" checks listen for a few phrases in English, Telugu and Hindi).
// Keyed by the check id from the scorecards (supabase/functions/_shared/calls/).

export interface CheckHelp {
  /** What the check looks at, in one sentence. */
  readonly means: string;
  /** What a fail or warning means, and when it can be a false alarm. */
  readonly miss: string;
}

const PHRASES =
  'We look for a few set phrases in English, Telugu and Hindi, so if she said it in other words this can be a false alarm: open the call to see.';

const HELP: Readonly<Record<string, CheckHelp>> = {
  // Guardrails (Asha)
  identity_first: {
    means:
      'Asha must confirm she is speaking to the right shopkeeper before saying any amount owed.',
    miss: 'Dues were said before the person confirmed who they are. That can leak money details to a stranger.',
  },
  recording_notice: {
    means: 'When dues are discussed, Asha must say the call is recorded.',
    miss: `The recording notice was not heard. Required for compliance. ${PHRASES}`,
  },
  amounts_from_tools: {
    means:
      'Every rupee figure the agent said must come from the book (a tool reply) or from the caller.',
    miss: 'The agent said an amount we cannot trace to the book or the caller: it may have made a number up.',
  },
  no_discount: {
    means: 'The agent must never offer a discount, waiver or reduced amount.',
    miss: 'A discount or waiver was offered. Only the owner can decide that.',
  },
  wrong_person: {
    means: 'If the person says they are not the shopkeeper, nothing about the dues may be shared.',
    miss: 'Dues were shared after the person said they were someone else.',
  },
  calling_hours: {
    means: 'Reminder calls should only go out between 8 am and 7 pm IST.',
    miss: 'This call was placed outside calling hours.',
  },
  // Outcome (Asha)
  result_recorded: {
    means:
      'A call should end with something saved: a promise to pay, a payment claim, or a request for the owner to call back.',
    miss: 'Nothing was recorded, so the follow-up has nothing to act on. Fine if the shopkeeper just refused to talk.',
  },
  promise_read_back: {
    means:
      'When a promise to pay is saved, Asha should repeat the amount back so both sides agree.',
    miss: 'The promised amount was saved but we did not hear Asha repeat it to the shopkeeper.',
  },
  callback_announced: {
    means:
      'When Asha logs that the shopkeeper wants the owner to call, she must also tell the shopkeeper the owner will call back.',
    miss: `The request was logged, but the shopkeeper may not know anyone will call. ${PHRASES}`,
  },
  closed_with_consent: {
    means: 'Before hanging up, the agent should ask whether it can end the call.',
    miss: `The agent ended without asking. Feels abrupt to the caller. ${PHRASES}`,
  },
  // Conversation
  longest_turn: {
    means: 'Each thing the agent says should be short enough to follow on a phone call.',
    miss: 'At least one reply was long. Long replies lose people on a call.',
  },
  long_turns: {
    means: 'How many of the agent replies were longer than the limit.',
    miss: 'Several replies were long. Worth tightening the prompt.',
  },
  interruptions: {
    means: 'When the caller talks over the agent, it should stop and listen.',
    miss: 'For information only: counts how often the agent stopped for the caller.',
  },
  repeated_figures: {
    means: 'The same amount should not be repeated again and again in a call.',
    miss: 'One amount came up in 3 or more replies. Sounds like nagging.',
  },
  // Tools
  tool_calls: {
    means: 'Which tools (book look-ups and saves) the agent used in this call.',
    miss: 'For information only.',
  },
  tool_errors: {
    means: 'A tool can refuse (for example a past due date) or fail (a server error).',
    miss: 'At least one tool refused or failed. A refusal is often correct; open the call to see which.',
  },
  slowest_tool: {
    means: 'How long our server took to answer the slowest tool call.',
    miss: 'A tool was slow, so the caller heard silence while waiting.',
  },
  repeated_calls: {
    means:
      'The agent should not call the same tool with the same details twice within a few seconds.',
    miss: 'A tool was called twice in a row for the same thing. Wastes time and can confuse the agent.',
  },
  // Speed
  call_setup: {
    means: 'How fast our server got the call ready after it was answered.',
    miss: 'Setup was slow, so the first words came late.',
  },
  reply_p50: {
    means: 'How long the caller usually waited for the agent to answer.',
    miss: 'Typical replies were slow. Calls feel laggy.',
  },
  reply_max: {
    means: 'The longest the caller waited for one agent answer.',
    miss: 'At least one long pause. The caller may think the line dropped.',
  },
  // Cost
  voice_cost: {
    means: "Sarvam's voice charge for this call (₹3.50 a minute plus GST).",
    miss: 'For information only.',
  },
  llm_cost: {
    means: 'What the AI cost after the call, for the summary and the next step.',
    miss: 'For information only.',
  },
  total_cost: {
    means: 'Everything this call cost, against our aim of ₹15 a call.',
    miss: 'Above the aim. Usually a long call.',
  },
  // After the call
  summary_writer: {
    means: 'Which AI wrote the owner’s WhatsApp summary after the call.',
    miss: 'Both AI models failed, so a plain backup message was sent instead.',
  },
  followup_time: {
    means: 'How soon after hang-up the owner got the WhatsApp summary.',
    miss: 'The summary was late.',
  },
  summary_matches: {
    means: 'The WhatsApp summary must state the same promise or claim that was actually saved.',
    miss: 'The summary and the saved record disagree. The owner could act on the wrong amount.',
  },
  // Munshi
  read_back_first: {
    means:
      'Before saving any change to the book, Munshi must read it back: who, what and how much.',
    miss: 'A change was saved without a read-back first.',
  },
  yes_before_save: {
    means: 'Every save must follow a clear yes from the owner to that read-back.',
    miss: 'We could not find a clear yes right after the read-back. A warning means a yes in other words or a turn later; a fail means no yes at all.',
  },
  whatsapp_on_request: {
    means: 'Munshi may send something on WhatsApp only when the owner asked for it.',
    miss: 'Something was sent on WhatsApp that the owner did not ask for.',
  },
  questions_answered: {
    means: 'How many of the owner’s questions were answered from the book.',
    miss: 'For information only.',
  },
  changes_done: {
    means: 'How many changes were saved or cancelled after the read-back.',
    miss: 'For information only.',
  },
  nothing_left_open: {
    means: 'Every read-back should end in a save or a cancel.',
    miss: 'Something was read back but never saved or cancelled, so the owner may think it was done.',
  },
  could_not_answer: {
    means: 'Questions where Munshi said the book cannot answer that.',
    miss: 'The owner asked something Munshi could not answer. A gap in what Munshi can do, not a mistake.',
  },
  // Tone (AI judge)
  tone_respectful: {
    means: 'An AI judge reads the whole call: was the agent polite and respectful?',
    miss: 'Scored low on politeness.',
  },
  tone_no_pressure: {
    means: 'An AI judge checks for pressure, threats or shaming.',
    miss: 'The judge heard pressure in how the agent spoke.',
  },
  tone_listened: {
    means: 'An AI judge checks the agent answered what the caller actually said.',
    miss: 'The agent seemed to ignore or talk past the caller.',
  },
  tone_clear: {
    means: 'An AI judge checks the agent was easy to follow on a phone call.',
    miss: 'Hard to follow: too long or muddled.',
  },
  tone_friendly: {
    means: 'An AI judge checks Munshi sounded like the friendly man from the shop next door.',
    miss: 'Sounded stiff or formal.',
  },
  tone_language_match: {
    means: 'An AI judge checks Munshi replied in the language the owner used.',
    miss: 'Replied in a different language from the owner.',
  },
  tone_on_point: {
    means: 'An AI judge checks Munshi answered exactly what was asked.',
    miss: 'Drifted off the question.',
  },
};

const TOOL_USE_PREFIX = 'tool_use_';

/** Help for one check id; tool-use rows share one line; unknown ids get null. */
export function checkHelp(id: string): CheckHelp | null {
  if (id.startsWith(TOOL_USE_PREFIX)) {
    const tool = id.slice(TOOL_USE_PREFIX.length);
    return {
      means: `The caller asked for something that needs ${tool}, so the agent should have used it.`,
      miss: `${tool} never ran: the agent answered without looking it up, or did not do what was asked. We spot the need from a few words in English, Telugu and Hindi, so open the call to confirm.`,
    };
  }
  return HELP[id] ?? null;
}
