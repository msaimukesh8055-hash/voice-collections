# Incident 3 — "Gave me" was read as new credit

**Date:** 2026-11-12 (M9 Build C) · **Area:** WhatsApp brain, rule-based parser · **Severity:** high (money direction) · **Customer impact:** none (fake data; stopped at the confirmation card)

## What happened

The owner types `Praveen gave me 1,000 rupees yesterday`. Praveen has paid. The bot offered a card to **add ₹1,000 of new credit** for Praveen: the opposite direction.

No model was involved. The message was answered in code.

## How it was caught

The brain eval set, case `brain-10`, on its first run. The case was written to check that a figure typed as `1,000` comes back as exactly 1,000; it failed for a different reason than the one it was written for.

## Why it happened

The parser decides "payment" from a list of payment words (paid, received, returned...). `gave` is not on it, on purpose: "gave Ramesh 5000" means goods given on credit. With no payment word, a name and an amount default to new credit. The parser had no notion of who the money was given to.

## The fix

In `_shared/brain/commands.ts`: "gave" or "given" together with "me" or "us" is a payment to the owner. "Gave" without them still means credit. "Me" and "us" are also no longer taken as part of a name.

## What stops it coming back

- Unit tests for both directions (`gave me` is a payment, `gave Praveen` is credit).
- Eval case `brain-10` is a **money case**: a failure fails the release gate.
- The confirmation card still shows what was understood before anything is saved.

## What it taught

Code is not automatically safer than a model. This was a rule-based bug that 1,400 unit tests had not caught, because nobody had written that sentence down. The eval set found it because it was written from how an owner talks, not from how the parser works.
