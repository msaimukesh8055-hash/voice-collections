# Threat model — Easy Recovery AI

Who could attack what, what stops them today, and what does not. One page, written 2026-11-12. It describes the prototype as built (fake data, one trader); the last section lists what a real deployment would need first.

## What is worth protecting

| Asset | Why it matters |
|---|---|
| The credit book (who owes what) | Wrong entries cost the trader money; leaked entries embarrass his customers |
| The ability to place calls and send messages | Spends money and reaches real people in the trader's name |
| Secrets (Meta, Sarvam, Supabase service role, signing secrets) | The service role key bypasses every database rule |
| Call transcripts | Hold what a shopkeeper said about their finances |

## The five doors

| Door | Who may come in | How that is enforced |
|---|---|---|
| `whatsapp-webhook` | Meta, carrying a message from the owner's number | HMAC signature over the raw body, checked before anything is read, compared in constant time. Then the sender must be the owner's number. Message ids are unique in the database, so a replay is dropped |
| `sarvam-tools` (Asha) | Sarvam, during an accepted call | Bearer secret, then a call token that is the call's id: it must be accepted, and no older than 10 minutes. The token decides the shopkeeper; nothing the model says can change who is being discussed |
| `munshi-tools` (owner's call line) | Sarvam, during the owner's call | A different bearer secret and a different token type. Asha's secret and tokens get nothing here, and the reverse. Every write is prepared, read back, and confirmed in a separate step |
| `calls-api` (dashboard, phone page) | A browser with the public key; dashboard reads need a signed link | HMAC-signed link token valid 24 hours; call actions are bound to a one-time token and the call's state; CORS allow-list; per-shopkeeper rate limit on starting calls |
| `followup-worker` | Our own functions and the database scheduler | Bearer worker secret, checked in constant time |

## Threats and what stops them

| # | Threat | Stopped by | Residual risk |
|---|---|---|---|
| 1 | Forged WhatsApp message ("Ramesh paid 8500") | Signature check; owner-number check | None known while the app secret is secret |
| 2 | Replayed or duplicated delivery saves an entry twice | Unique message id; a card can be saved once (compare-and-set) | – |
| 3 | A shopkeeper talks Asha into revealing or changing a balance (prompt injection) | Dues are not returned before identity is confirmed, in code. No tool can reduce a balance; a claim is only a claim. Tested as an eval case | Asha could still *say* something untrue. The guardrail "never says the balance is reduced" is judged on every eval case, not enforced in code |
| 4 | Injection through the owner's own message or a voice note transcript | The model only suggests a command from a fixed list; code checks the figures and refuses a money card for a promise; nothing is saved without a tap | A wrong card could be shown; the owner must read it |
| 5 | Someone answers the phone who is not the shopkeeper | Identity question first; `get_dues` refuses until confirmed | A person who lies about being the shopkeeper hears the dues. Name confirmation is weak identity |
| 6 | A stolen tool secret is used to read dues | It is useless without a live call token (accepted, under 10 minutes old) | Within a live call's window, a holder of both could read that one shopkeeper |
| 7 | Scripted abuse of the public key to place calls | Rate limit per shopkeeper, attempt limits, daily session cap, the pause switch | The public key can still read the ringing state and start the demo ring |
| 8 | A leaked dashboard link | Expires in 24 hours; read-only apart from one display setting | Anyone holding it within 24 hours sees the book |
| 9 | Personal data in logs or traces | Logs and ops events carry ids, codes and timings only, by rule and by test; prompts and answers are never logged | A new log line could break the rule; review catches it, nothing automatic does |
| 10 | A runaway agent or loop spends money | Call length cap, session caps, spend shown against a cap, the pause switch, the failure alert | The spend cap is displayed, not enforced |
| 11 | Direct database access with the public key | Row-level security is on for every table with no public policies; functions use the service role | A mistake in a future policy would be silent |

## What is deliberately open in the demo

- **No login.** The prototype has no user accounts. The signed link is the only gate on the dashboard.
- **`DASHBOARD_PUBLIC=on`** opens every dashboard read (and the one display setting) to anyone with the web address. It exists for showing the demo and must be off anywhere real.
- **The Ops and Evals pages** follow the same rule. They hold no personal data, by construction.

## Before any real trader's data

1. Real sign-in for the owner, and the public demo switch removed.
2. Consent and opt-out for shopkeepers, recorded, before any call or message.
3. Stronger identity than a name before dues are spoken.
4. A hard spend limit, not a displayed one.
5. Secrets out of a laptop `.env` and into a managed store, with rotation dates.
6. Retention rules for transcripts, and deletion on request.
7. An independent security review.
