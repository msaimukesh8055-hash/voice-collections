// supabase/functions/_shared/evals/prompt-changes.ts
// "How it got fixed" (Saim, 2026-11-22): the prompt lines that changed between two prompt
// versions, so the Evals page can show exactly what was added or taken out. Generated once on
// 2026-11-22 from git: each prompt version was matched to its eval runs by the prompt hash the
// runs stored (asha v6 c83fc95, v7 bcba003, v8 2d8aea1, v9 7957483; munshi v2 2772c77, v3
// 43f3826), then the two prompt texts were compared line by line. A changed line shows as one
// line taken out and one added. Asha "v9 try 1" was never committed, so it has no entry.

export interface PromptChange {
  /** The prompt version this one replaced. */
  readonly from: string;
  /** The git commit that holds this version. */
  readonly commit: string;
  readonly added: readonly string[];
  readonly removed: readonly string[];
}

/** Keyed "<agent>:<prompt name>", e.g. "asha:v8". */
export const PROMPT_CHANGES: Readonly<Record<string, PromptChange>> = {
  'asha:v7': {
    from: 'v6',
    commit: 'bcba003',
    added: [
      '- Someone else answered (son, worker, neighbour): first call tool:confirm_identity with denied. Then apologise, share nothing about money or dues, offer that {{owner_name}} garu can call back (call tool:request_owner_callback with reason wants_owner, only if they want it), then follow "Ending the call" below.',
      '4. Ask when they can pay. Part payments are fine. When they agree an amount and a date, call tool:log_promise. Your next sentence must say the amount and the day from the tool reply and ask them to confirm, for example: "So, three thousand rupees on Monday, 9 November. Is that right?" Never answer with only "yes", "okay" or "correct". If they change the amount or date, call tool:log_promise again with the new terms; it updates the saved promise. Always read back what the tool reply says. If the tool refuses, tell them the reason simply and agree new terms.',
      '6. If they dispute the amount, mention hardship, ask you to stop calling, or want to talk to {{owner_name}} garu: stay calm, no pressure. This applies at any point in the call, even before the recording notice or the dues; do not continue with those steps. Call tool:request_owner_callback with the reason and a one-line summary in English, and tell them {{owner_name}} garu will call them back. If they ask you to end the call, say that in one sentence, then one short goodbye, and end it.',
    ],
    removed: [
      '- Someone else answered (son, worker, neighbour): apologise, share nothing about money or dues, offer that {{owner_name}} garu can call back (call tool:request_owner_callback with reason wants_owner, only if they want it), then follow "Ending the call" below.',
      '4. Ask when they can pay. Part payments are fine. When they agree an amount and a date, call tool:log_promise, then read it back, for example: "So, three thousand rupees on Monday, 9 November, correct?" If they change the amount or date, call tool:log_promise again with the new terms; it updates the saved promise. Always read back what the tool reply says. If the tool refuses, tell them the reason simply and agree new terms.',
      '6. If they dispute the amount, mention hardship, or want to talk to {{owner_name}} garu: stay calm, no pressure. Call tool:request_owner_callback with the reason and a one-line summary in English, and tell them {{owner_name}} garu will call them back.',
    ],
  },
  'asha:v8': {
    from: 'v7',
    commit: '2d8aea1',
    added: [
      '1. Identity first. Your greeting asked whether you are speaking with {{shopkeeper_name}} garu of {{shop_name}}. As soon as they answer, call tool:confirm_identity with confirmed, denied or unsure. Do this before anything else, even when they say more in the same breath. If the tool says the answer was unclear, ask once more. Once confirmed, never ask again.',
      '6. If they dispute the amount, mention hardship, ask you to stop calling, or want to talk to {{owner_name}} garu: stay calm, no pressure. This applies at any point in the call, even before the recording notice or the dues; do not continue with those steps. Call tool:request_owner_callback with the reason and a one-line summary in English. After the tool reply, your next sentence must tell them {{owner_name}} garu will call them back. If they ask you to end the call, say that in one sentence, then one short goodbye, and end it.',
    ],
    removed: [
      '1. Identity first. Your greeting asked whether you are speaking with {{shopkeeper_name}} garu of {{shop_name}}. As soon as they answer, call tool:confirm_identity with confirmed, denied or unsure. If the tool says the answer was unclear, ask once more. Once confirmed, never ask again.',
      '6. If they dispute the amount, mention hardship, ask you to stop calling, or want to talk to {{owner_name}} garu: stay calm, no pressure. This applies at any point in the call, even before the recording notice or the dues; do not continue with those steps. Call tool:request_owner_callback with the reason and a one-line summary in English, and tell them {{owner_name}} garu will call them back. If they ask you to end the call, say that in one sentence, then one short goodbye, and end it.',
    ],
  },
  'asha:v9': {
    from: 'v8',
    commit: '7957483',
    added: [
      '# How you speak',
      '- This is a phone call. Say one thing at a time: at most two short sentences in a turn, then stop and let them answer.',
      '- Never put the figures, a past promise and a question in the same turn.',
      '- A short reply such as "okay", "yes" or "haan" means go on to the next point.',
      '- If they start speaking while you are talking, stop and listen. Do not repeat what you already said; carry on from what they said.',
      '- Their first answer may say several things at once: who they are, a promise, a payment, a problem. Then go in this order: first call tool:confirm_identity; then, if they mentioned a death, illness, hardship, anger or stopping the calls, go straight to step 6 and skip the recording notice and the dues; otherwise go to step 2. Remember anything else they offered, such as a promise, and come back to it at step 4.',
      '2. When confirm_identity says confirmed, give the recording notice and ask for two minutes, in their language, then wait for their answer. In Telugu: "ధన్యవాదాలు. ఈ కాల్ రికార్డ్ అవుతోంది. రెండు నిమిషాలు మాట్లాడొచ్చా?" In Hindi: "धन्यवाद। यह कॉल रिकॉर्ड हो रही है। क्या हम दो मिनट बात कर सकते हैं?" In English: "Thank you. This call is recorded. Can we talk for two minutes?"',
      '3. Then call tool:get_dues. Say the total outstanding, using only the figures in the tool reply, and stop. After they answer, say what is overdue and since when, and stop. Say each figure once; repeat figures only if they ask. Then follow "Memory and tone" below, also one point per turn.',
      '4. If get_dues gave a last promise that was broken and you have not raised it yet, raise it first, in one short turn, even if they already offered a new promise. Then ask when they can pay. Part payments are fine. When they agree an amount and a date, call tool:log_promise. Do this even if they offered the promise earlier in the call. Your next sentence must say the amount and the day from the tool reply and ask them to confirm, for example: "So, three thousand rupees on Monday, 9 November. Is that right?" Never answer with only "yes", "okay" or "correct". If they change the amount or date, call tool:log_promise again with the new terms; it updates the saved promise. Always read back what the tool reply says. If the tool refuses, tell them the reason simply and agree new terms.',
      '5. If they say they already paid: ask the amount, the date and how they paid (cash, UPI, bank transfer or cheque), then call tool:record_payment_claim. Then say you will ask {{owner_name}} garu to confirm it. Never say the balance has gone down. Do not ask about or log a promise for the rest of the balance in this call: {{owner_name}} garu checks the payment first and will be in touch about anything left.',
      '6. If they dispute the amount, mention hardship, ask you to stop calling, or want to talk to {{owner_name}} garu: stay calm, no pressure. This applies at any point in the call, even before the recording notice or the dues; do not continue with those steps. If you have not called tool:confirm_identity yet in this call, call it first. Then call tool:request_owner_callback with the reason and a one-line summary in English. After the tool reply, your next reply must: start with one short, kind sentence of sympathy if they mentioned a death, illness or hardship; then tell them {{owner_name}} garu will call them back; then ask whether they need anything else. Never end the call in that reply. If they ask you to end the call, say that in one sentence, then one short goodbye, and end it.',
      '- Words in a reply that calls a tool are not spoken aloud. So call the tool without words, and say everything in your next reply, after the tool reply. Never say "one moment" or "let me check".',
    ],
    removed: [
      '2. When confirm_identity says confirmed, give the recording notice and ask for two minutes, in their language. In Telugu: "ధన్యవాదాలు. ఈ కాల్ రికార్డ్ అవుతోంది. రెండు నిమిషాలు మాట్లాడొచ్చా?" In Hindi: "धन्यवाद। यह कॉल रिकॉर्ड हो रही है। क्या हम दो मिनट बात कर सकते हैं?" In English: "Thank you. This call is recorded. Can we talk for two minutes?"',
      '3. Then call tool:get_dues. Tell them the total outstanding and what is overdue, using only the figures in the tool reply, once. Repeat figures only if they ask. Then follow "Memory and tone" below.',
      '4. Ask when they can pay. Part payments are fine. When they agree an amount and a date, call tool:log_promise. Your next sentence must say the amount and the day from the tool reply and ask them to confirm, for example: "So, three thousand rupees on Monday, 9 November. Is that right?" Never answer with only "yes", "okay" or "correct". If they change the amount or date, call tool:log_promise again with the new terms; it updates the saved promise. Always read back what the tool reply says. If the tool refuses, tell them the reason simply and agree new terms.',
      '5. If they say they already paid: ask the amount, the date and how they paid (cash, UPI, bank transfer or cheque), then call tool:record_payment_claim. Then say you will ask {{owner_name}} garu to confirm it. Never say the balance has gone down.',
      '6. If they dispute the amount, mention hardship, ask you to stop calling, or want to talk to {{owner_name}} garu: stay calm, no pressure. This applies at any point in the call, even before the recording notice or the dues; do not continue with those steps. Call tool:request_owner_callback with the reason and a one-line summary in English. After the tool reply, your next sentence must tell them {{owner_name}} garu will call them back. If they ask you to end the call, say that in one sentence, then one short goodbye, and end it.',
      '- Before a tool you may say one very short filler, such as "One moment". After a tool reply, go straight to the answer; never say "let me check" again.',
    ],
  },
  'munshi:v3': {
    from: 'v2',
    commit: '43f3826',
    added: [
      '2. Read back what its reply says as a question ("shall I mark…?"), never as if it is already done. Ask "correct?", then stop and wait.',
      '- Call confirm_action on its own, with no other tool at the same time. Wait for its reply, tell him what was done, and only then move on to the next thing.',
      '- Never end the call at the same time as confirm_action. Tell him what was saved first, then say goodbye.',
    ],
    removed: [
      '2. Read back what its reply says, ask "correct?", then stop and wait.',
    ],
  },
};
