// supabase/functions/_shared/db/supabase-book-repository.ts
// BookRepository on Supabase's HTTP API (service role). The API returns at most 1,000 rows per
// request (project setting), and the book holds ~2,200 entries, so listEntries reads in pages.
// Card buttons use compare-and-set updates (filter on the expected status), so a double tap
// updates no row the second time.
import { z } from 'zod';
import { type PostgrestClient, RepositoryError, UNIQUE_VIOLATION } from './postgrest.ts';
import type {
  BookEntry,
  BookRepository,
  BookShopkeeper,
  LastPromise,
  Owner,
  PendingAction,
} from './book-repository.ts';
import {
  ACTION_COLUMNS,
  ACTION_ROW,
  BOOK_SHOPKEEPER_COLUMNS,
  BOOK_SHOPKEEPER_ROW,
  ENTRY_COLUMNS,
  ENTRY_ROW,
  LAST_PROMISE_ROW,
  OWNER_COLUMNS,
  OWNER_ROW,
} from './book-rows.ts';
import { firstRow, IdRow } from './supabase-rows.ts';

export const PAGE_SIZE = 1000;
/** 20 pages = 20,000 entries: far above the demo book; stops a runaway loop. */
const MAX_PAGES = 20;
const SHOPKEEPER_LIMIT = 1000;
const SHOPKEEPER_ENTRY_LIMIT = 1000;

const id = encodeURIComponent;
const RETURN_ROW = 'return=representation';

function isUniqueViolation(error: unknown): boolean {
  return error instanceof RepositoryError && error.code === UNIQUE_VIOLATION;
}

function readQueries(
  query: PostgrestClient,
): Pick<
  BookRepository,
  'getOwner' | 'listShopkeepers' | 'listEntries' | 'listShopkeeperEntries' | 'getLastPromise'
> {
  return {
    async getOwner(): Promise<Owner | null> {
      const path = `owners?select=${OWNER_COLUMNS}&order=created_at&limit=1`;
      return firstRow(OWNER_ROW, (await query('getOwner', path)).rows);
    },
    async listShopkeepers(ownerId): Promise<readonly BookShopkeeper[]> {
      const path = `shopkeepers?select=${BOOK_SHOPKEEPER_COLUMNS}&owner_id=eq.${id(ownerId)}` +
        `&order=name&limit=${SHOPKEEPER_LIMIT}`;
      return z.array(BOOK_SHOPKEEPER_ROW).parse((await query('listShopkeepers', path)).rows);
    },
    async listEntries(ownerId): Promise<readonly BookEntry[]> {
      const base = `ledger_entries?select=${ENTRY_COLUMNS},shopkeepers!inner(owner_id)` +
        `&shopkeepers.owner_id=eq.${id(ownerId)}&order=entry_date,id&limit=${PAGE_SIZE}`;
      let all: BookEntry[] = [];
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const rows = z.array(ENTRY_ROW).parse(
          (await query('listEntries', `${base}&offset=${page * PAGE_SIZE}`)).rows,
        );
        all = [...all, ...rows];
        if (rows.length < PAGE_SIZE) return all;
      }
      throw new RepositoryError('listEntries', 'too many pages');
    },
    async listShopkeeperEntries(shopkeeperId): Promise<readonly BookEntry[]> {
      const path = `ledger_entries?select=${ENTRY_COLUMNS}&shopkeeper_id=eq.${id(shopkeeperId)}` +
        `&order=entry_date,created_at&limit=${SHOPKEEPER_ENTRY_LIMIT}`;
      return z.array(ENTRY_ROW).parse((await query('listShopkeeperEntries', path)).rows);
    },
    async getLastPromise(shopkeeperId): Promise<LastPromise | null> {
      const path = `promises?select=amount,promise_date,status` +
        `&shopkeeper_id=eq.${id(shopkeeperId)}&order=created_at.desc&limit=1`;
      return firstRow(LAST_PROMISE_ROW, (await query('getLastPromise', path)).rows);
    },
  };
}

function bookWrites(
  query: PostgrestClient,
): Pick<BookRepository, 'insertShopkeeper' | 'insertEntry' | 'settleClaim'> {
  return {
    async insertShopkeeper(shopkeeper): Promise<BookShopkeeper> {
      const body = {
        owner_id: shopkeeper.ownerId,
        name: shopkeeper.name,
        shop_name: shopkeeper.shopName,
        area: shopkeeper.area,
        phone: shopkeeper.phone,
        language: shopkeeper.language,
      };
      const path = `shopkeepers?select=${BOOK_SHOPKEEPER_COLUMNS}`;
      const result = await query('insertShopkeeper', path, {
        method: 'POST',
        body,
        prefer: RETURN_ROW,
      });
      const row = firstRow(BOOK_SHOPKEEPER_ROW, result.rows);
      if (!row) throw new RepositoryError('insertShopkeeper', 'no row');
      return row;
    },
    async insertEntry(entry): Promise<string> {
      const body = {
        shopkeeper_id: entry.shopkeeperId,
        kind: entry.kind,
        amount: entry.amount,
        entry_date: entry.entryDate,
        due_date: entry.dueDate,
        status: 'confirmed',
        source: 'text',
        note: entry.note,
      };
      const request = { method: 'POST', body, prefer: RETURN_ROW } as const;
      const row = firstRow(
        IdRow,
        (await query('insertEntry', 'ledger_entries?select=id', request)).rows,
      );
      if (!row) throw new RepositoryError('insertEntry', 'no row');
      return row.id;
    },
    async settleClaim(entryId, status): Promise<BookEntry | null> {
      const path = `ledger_entries?id=eq.${id(entryId)}&kind=eq.payment&status=eq.claimed` +
        `&select=${ENTRY_COLUMNS}`;
      const request = { method: 'PATCH', body: { status }, prefer: RETURN_ROW } as const;
      return firstRow(ENTRY_ROW, (await query('settleClaim', path, request)).rows);
    },
  };
}

function actionQueries(
  query: PostgrestClient,
): Pick<BookRepository, 'createPendingAction' | 'getPendingAction' | 'transitionPendingAction'> {
  return {
    async createPendingAction(action): Promise<string> {
      const body = {
        owner_id: action.ownerId,
        kind: action.kind,
        payload: action.payload,
        expires_at: action.expiresAt,
      };
      const request = { method: 'POST', body, prefer: RETURN_ROW } as const;
      const result = await query('createPendingAction', 'pending_actions?select=id', request);
      const row = firstRow(IdRow, result.rows);
      if (!row) throw new RepositoryError('createPendingAction', 'no row');
      return row.id;
    },
    async getPendingAction(actionId): Promise<PendingAction | null> {
      const path = `pending_actions?select=${ACTION_COLUMNS}&id=eq.${id(actionId)}`;
      return firstRow(ACTION_ROW, (await query('getPendingAction', path)).rows);
    },
    async transitionPendingAction(actionId, from, to): Promise<boolean> {
      const path = `pending_actions?id=eq.${id(actionId)}&status=eq.${from}&select=id`;
      const body = { status: to, resolved_at: new Date().toISOString() };
      const request = { method: 'PATCH', body, prefer: RETURN_ROW } as const;
      const rows = (await query('transitionPendingAction', path, request)).rows;
      return z.array(IdRow).parse(rows).length === 1;
    },
  };
}

function messageQueries(
  query: PostgrestClient,
): Pick<
  BookRepository,
  'recordInbound' | 'markInboundHandled' | 'recordOutbound' | 'claimStrangerReply'
> {
  async function insertOnce(operation: string, body: object): Promise<boolean> {
    try {
      await query(operation, 'wa_messages', { method: 'POST', body, prefer: 'return=minimal' });
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }
  return {
    recordInbound: (message) =>
      insertOnce('recordInbound', {
        wa_message_id: message.waMessageId,
        direction: 'in',
        sender_hash: message.senderHash,
        msg_type: message.msgType,
        ist_day: message.istDay,
      }),
    async markInboundHandled(waMessageId, result): Promise<void> {
      const path = `wa_messages?wa_message_id=eq.${id(waMessageId)}&direction=eq.in`;
      const body = { path: result.path, command: result.command };
      await query('markInboundHandled', path, { method: 'PATCH', body, prefer: 'return=minimal' });
    },
    async recordOutbound(message): Promise<void> {
      await insertOnce('recordOutbound', {
        wa_message_id: message.waMessageId,
        direction: 'out',
        sender_hash: message.senderHash,
        msg_type: message.msgType,
        ist_day: message.istDay,
      });
    },
    claimStrangerReply: (senderHash, istDay) =>
      insertOnce('claimStrangerReply', {
        direction: 'out',
        sender_hash: senderHash,
        msg_type: 'text',
        path: 'stranger',
        command: 'not_registered',
        ist_day: istDay,
      }),
  };
}

export function createSupabaseBookRepository(query: PostgrestClient): BookRepository {
  return {
    ...readQueries(query),
    ...bookWrites(query),
    ...actionQueries(query),
    ...messageQueries(query),
  };
}
