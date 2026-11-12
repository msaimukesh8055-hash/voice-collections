# Unit economics — Easy Recovery AI

What it costs to run this for one trader, what it could earn, and where the money goes. Written 2026-11-12 from the build's own data. Every figure is marked **measured** (read from the live database or a price list) or **assumed** (a guess to be replaced with real data).

> The book is fake demo data (100 invented shopkeepers), so recovery figures are illustrations, not results. Costs are real.

## 1. What one unit costs

| Unit | Cost | Basis |
|---|---|---|
| One connected reminder call (Asha) | **₹12.39** | Measured: 9 live calls, average 143 seconds, every one billed as 3 minutes. Sarvam voice is ₹3.50 a started minute + 18% GST |
| One WhatsApp message read by the AI | **about ₹0.02** | Estimated from the prompt size (about 550 tokens in, 60 out) at Sarvam's documented ₹29.28 / ₹73.20 per million tokens + GST. Real token counts are now recorded per call; none has been logged since the deploy |
| One WhatsApp message answered in code | **₹0** | Measured: 89 of 130 owner messages (68%) were buttons or fixed commands and never reached a model |
| One follow-up decision after a call | **about ₹0.07** | Assumed: about 1,500 tokens in, 200 out. Clear cases are decided by rules in code and cost nothing |
| One Sarvam Tests eval run (9 cases) | **not measured** | The wallet balance was not readable from the build session |
| Database, hosting | **₹0** | Measured: Supabase and Vercel free tiers |

**Not included:** speech-to-text and text-to-speech for voice notes (no voice note is in the measured data), and Meta's fee for a template message sent outside the 24-hour window (the daily due alert can be one; Meta's rate was not verified).

## 2. One trader, one month

Assumptions: 100 shopkeepers, 40 of them overdue in a month, each called 1.5 times on average, and the owner sending 300 WhatsApp messages.

| Line | Volume | Cost |
|---|---|---|
| Reminder calls | 60 connected calls × ₹12.39 | ₹743 |
| Follow-up decisions | 60 × ₹0.07 | ₹4 |
| WhatsApp, AI-read | 300 × 32% × ₹0.02 | ₹2 |
| WhatsApp, in code | 300 × 68% | ₹0 |
| **Total** | | **about ₹750** |

**Voice minutes are 99% of the cost.** Everything else rounds to nothing, which is what answering in code first was meant to achieve.

## 3. What it has to recover to be worth it

- Measured from the demo book: ₹7.6 lakh outstanding across 100 shopkeepers; the average promise to pay is ₹6,476.
- At ₹750 a month, the service pays for itself if it brings in **one extra average promise in eight months**, or about ₹750 of money that would otherwise have slipped.
- Illustration only: one extra kept promise a month would be ₹6,476 recovered for ₹750 spent, about 8.6 times the cost. The demo data cannot show whether that happens; a pilot with a real trader would.

## 4. What a trader could be charged

| Model | Price | Margin at 60 calls |
|---|---|---|
| Flat monthly | ₹1,499 | about 50% |
| Per connected call | ₹20 | about 38% |
| Flat + usage | ₹499 + ₹15 a call | about 46% |

A flat price is easier for a small trader to accept; per-call pricing protects the margin if a trader calls far more than expected. These are starting points for a pricing test, not tested prices.

## 5. Where to cut cost

1. **Call length.** Every measured call ran between 2 and 3 minutes and was billed as 3. A call that ends inside 2 minutes costs ₹8.26, a third less. The average call is 143 seconds, so 23 seconds shorter saves ₹4.13 a call, about ₹250 a month per trader. The longest lever in the product is Asha's wording, not the model price.
2. **Do not call when a message will do.** A WhatsApp reminder to the shopkeeper costs a fraction of a call. The product has no shopkeeper messaging today (the Meta test number reaches only registered numbers).
3. **Call the right people.** The reliability score already ranks shopkeepers; calling only those likely to respond cuts minutes without cutting recovery.

## 6. What would change these numbers

- Sarvam's two price lists disagree for the LLM (the documentation says ₹29.28 / ₹73.20 per million tokens, the marketing page ₹4 / ₹16). The higher one is used here. It barely matters: the LLM is under 1% of cost either way.
- Real answer rates. The model above counts connected calls only; unanswered calls cost nothing.
- Beyond the free tiers, Supabase Pro is a fixed monthly fee shared across every trader on the project.
