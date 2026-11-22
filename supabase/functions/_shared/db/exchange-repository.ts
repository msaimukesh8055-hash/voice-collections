// supabase/functions/_shared/db/exchange-repository.ts
// WhatsApp live checks (ADR-0022): the webhook writes one row per owner message (wa_exchanges);
// the dashboard reads the latest ones with the state of any Save card they showed. Service role.
import type { NewExchange } from '../whatsapp/exchange.ts';
import type { ActionStatus } from './book-repository.ts';

export interface ExchangeRow extends NewExchange {
  readonly id: string;
  readonly createdAt: string;
  /** The card this exchange showed, as it stands now; null when it showed none or it is gone. */
  readonly card: { readonly status: ActionStatus; readonly expiresAt: string } | null;
}

export interface ExchangeLog {
  record(exchange: NewExchange): Promise<void>;
}

export interface ExchangeReads {
  /** Newest first, at most `limit`. */
  listExchanges(limit: number): Promise<readonly ExchangeRow[]>;
}
