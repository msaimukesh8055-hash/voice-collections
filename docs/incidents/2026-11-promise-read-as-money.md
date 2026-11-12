# Incident 1 — A promise to pay was turned into a money entry

**Dates:** 2026-11-04 (first form), 2026-11-12 (second form) · **Area:** WhatsApp brain · **Severity:** high (money direction) · **Customer impact:** none (fake data; stopped at the confirmation card)

## What happened

The owner types what a shopkeeper told him: `Ramesh will pay 5000 by 15th`. This is a promise about money already owed. Nothing should be added to the book.

**First form (M6 live smoke, 2026-11-04).** The message was read as a payment: the bot offered a card to record ₹5,000 as paid. The rule-based parser saw the word "pay" and an amount and concluded a payment had happened.

**Second form (M9 evals, 2026-11-12).** After the first fix, the parser correctly declined to guess and passed the message to the model. The model then suggested **new credit** of ₹5,000 due on the 15th. The first fix had moved the mistake from the code to the model.

## How it was caught

- First form: Saim, sending real messages during the M6 smoke test.
- Second form: the brain eval set, case `brain-19`, which was written from the first incident. It failed on the first run of the evals.

## Why it happened

1. The parser treated "pay" as proof of a payment, without looking for words that mean the money is still owed ("will", "has to", "later").
2. The first fix handed unclear messages to the model and trusted its answer. Nothing checked that the answer was a sensible kind of command for that message.

## The fix

1. **2026-11-04:** a payment word next to a "still owed" word or a due date is no longer treated as a payment in code; the model decides.
2. **2026-11-12:** a guard in code after the model. A message that is a promise to pay (a payment word, a "still owed" word, and no credit word) can never become a card that moves money, whatever the model suggests (`notAPromise` in `_shared/brain/interpret.ts`). A real credit with a due date (`... credit ichchaanu`) is still allowed.

## What stops it coming back

- Unit tests for both forms (`commands.test.ts`, `interpret.test.ts`).
- Eval case `brain-19` is a **money case**: if it fails, the release gate fails on its own.
- The confirmation card remains: nothing is saved until the owner taps Save.

## What it taught

Fixing a model-adjacent bug by "letting the model decide" only moves the risk. The second fix is the right shape: the model may suggest, code decides what is allowed.
