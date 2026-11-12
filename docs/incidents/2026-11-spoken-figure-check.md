# Incident 2 — A spoken summary could say a figure the ledger never had

**Date:** 2026-11-07 (M7 Build A) · **Area:** WhatsApp voice replies · **Severity:** high (a wrong amount, spoken aloud) · **Customer impact:** none (found before release; fake data)

## What happened

When the owner sends a voice note, the bot answers in text and then with a short spoken summary. The summary is written by a model, so before it is spoken, code checks that every figure in it also appears in the text reply on screen. If the check fails, the bot falls back to a plain, code-built summary.

The check had a hole. A scale word glued to a digit, such as `5thousand`, `5lakh`, `5వేలు` (Telugu: "5 thousand") or `5हज़ार` (Hindi: "5 thousand"), was let through whenever a bare `5` appeared anywhere in the reply, for example in "5 days overdue". The voice could have said "Ramesh owes five thousand" when the screen said something else.

## How it was caught

The tester agent, writing edge cases for the check after the feature was built: figures written in unusual ways, mixed scripts, and scale words in three languages. No live message produced the fault.

## Why it happened

The check split the summary into words at spaces and then looked for scale words ("thousand", "lakh") as whole words. `5thousand` is one word by that rule, so it was treated as the plain number 5, which the reply did contain.

## The fix

In `_shared/whatsapp/spoken-check.ts`: words are now split at digits as well as spaces, so `5thousand` is read as `5` and `thousand`. The short forms `k`, `lac` and `lacs` were added to the scale words at the same time.

## What stops it coming back

- The tester's cases stay in the suite: glued scale words in English, Hindi and Telugu, `k` / `lac` / `lacs`, a wrong figure in the middle of a sentence, Indian and Western digit grouping, and mixed digit scripts.
- The fallback is unchanged: a summary that fails any check is never spoken; the plain version is.

## What it taught

A check on model output is only as good as its idea of what a "number" looks like. Models write numbers in ways people do not type. The useful test cases came from asking "how else could this be written?", not from the happy path.
