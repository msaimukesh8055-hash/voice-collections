# Walkthrough — one message, end to end

A script for explaining the system in your own words, in about five minutes. It follows one WhatsApp message from the trader's phone to the database and back, then one reminder call. Open the **Ops** page and a trace while you talk; every step below is a row on that screen.

## The one-sentence version

"A small trader runs his credit book by chatting on WhatsApp. Code handles everything it can; the AI is asked only when code cannot read the message; and nothing touches money until the owner taps Save."

## Part 1: the owner types `Suresh paid 3000`

| # | What happens | Where | What to say |
|---|---|---|---|
| 1 | Meta delivers the message to our webhook | `whatsapp-webhook` | "This is the only door for WhatsApp. Meta calls it; nobody else should." |
| 2 | The signature on the request is checked against our app secret | `whatsapp-webhook` | "Before reading a single byte we prove it came from Meta. A forged request gets a 401 and is logged as a warning." |
| 3 | We answer Meta "received" at once and carry on in the background | `whatsapp-webhook` | "Meta retries if we are slow. So we acknowledge first and do the work after. A slow AI can never cause a duplicate." |
| 4 | The sender is checked: is this the owner's number? | `whatsapp-webhook` | "The bot answers one number. A stranger gets one polite 'not registered' a day." |
| 5 | The message id is recorded; a repeat of the same id is dropped | database | "If Meta sends the same message five times, it is handled once. The database enforces it, not our memory." |
| 6 | Code tries to read the message: name, amount, a payment word | the parser | "This message is plain, so code reads it: Suresh, 3000, paid. No AI call, no cost, no chance of invention. About two thirds of messages end here." |
| 7 | *(Only when code cannot read it)* Sarvam's model is asked, with Gemini as a backup | the brain | "The model returns a suggestion in a fixed format. If the format is wrong we reject it and ask the second model. If both fail, the owner gets the menu." |
| 8 | Code checks the suggestion | the brain | "A figure the owner typed must come back unchanged. A promise to pay can never become a payment. The model suggests; code decides what is allowed." |
| 9 | A card goes back: "Record ₹3,000 paid by Suresh? [Save] [Cancel]" | WhatsApp | "Nothing is saved yet. The owner sees exactly what was understood." |
| 10 | The owner taps Save; the entry is written once | database | "Two quick taps save once. If the database fails mid-save the card reopens, so nothing is half-saved." |

**On the trace you will see:** `request` (the delivery and how long it took), then either nothing more (code read it) or `brain_llm` with the provider and time, `llm_usage` with the token counts, and the reply.

## Part 2: Asha calls a shopkeeper

| # | What happens | What to say |
|---|---|---|
| 1 | The owner taps Remind. Pre-call rules run in code: paused? do-not-call? calling hours? attempt limits? | "The AI never decides whether a call is allowed. These are rules." |
| 2 | A call row is created; its id is the one-time token for this call | "That token is the only thing Asha has. It says which shopkeeper this is; the AI never chooses who it is talking about." |
| 3 | The shopkeeper answers in the browser; Sarvam runs the voice | "Speech in and out is Sarvam's platform. Our part is the prompt and the tools." |
| 4 | Asha asks "am I speaking with Ramesh?" and calls `confirm_identity` | "Until this tool records 'confirmed', the tool that returns dues refuses to answer. Asha cannot say an amount she was never given." |
| 5 | Asha calls `get_dues`; the reply is a ready sentence built in code, with the tone level | "How firm to be is worked out from broken promises and days overdue, in code. Asha is told the level; she does not pick it." |
| 6 | The shopkeeper promises; `log_promise` saves it, one per call | "A claim of 'I already paid' is recorded as a claim. It never changes the balance; only the owner confirms money." |
| 7 | The call ends; the follow-up worker reads the transcript and sends the owner a summary | "Clear outcomes are handled by rules. The model is used for the judgement calls only." |

**On the trace you will see:** one `request` per tool call to `sarvam-tools`, each with `tool_call`, the tool name and its time against the 500 ms target.

## Questions you should expect, and where the answer is

| Question | Answer | Proof |
|---|---|---|
| "How do you know it works?" | 9 Asha cases on Sarvam's test platform plus our own database checks; 21 brain messages; a release gate | **Evals** page |
| "What happens when the AI is wrong?" | It can only suggest. Code checks figures, names and direction; the owner confirms | `docs/incidents/` |
| "How do you know when it breaks?" | Every request is traced; a WhatsApp alert within 5 minutes | **Ops** page, an alert on your phone |
| "How do you limit the damage?" | `/pause` stops every new call in one message | Ops page shows "Paused" |
| "What does it cost?" | About ₹12 a call; voice minutes are 99% of cost | `docs/unit-economics.md` |
| "What would you do differently?" | See below | – |

## Be the first to say the limits

- It is a prototype on fake data: one trader, a Meta test number, calls in a browser, not on phone lines.
- Asha's current version **fails** the release gate (16 of 18 behaviours; the bar is 90%). Three specific behaviours need a prompt change. Say this plainly: a gate that can fail is the point of having one.
- Sarvam's test platform is text. It cannot hear accent, noise or interruption; real calls can still surprise.
- There is no login. The dashboard opens from a signed 24-hour link.

## What I would do next with a real trader

1. A two-week pilot with one trader and twenty shopkeepers, to replace every assumed number in the unit economics with a measured one.
2. Shorten Asha's calls: every call is billed as three minutes and averages 143 seconds.
3. Real phone calls and WhatsApp reminders to shopkeepers, which need a verified Meta number and consent.
