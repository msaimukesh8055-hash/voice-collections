// web/src/features/trace/plainLabels.ts
// Readable traces (Saim, 2026-11-23): the plain-English name of each recorded step and each agent
// tool, worked out from what the step or tool sent and got back. The tool's real name still shows
// small next to it, so an engineer can find it in code. Unknown steps fall back to their name
// with the underscores taken out.
import { formatInr, shortDate } from '../dashboard/format.ts';
import type { TraceStep } from '../../lib/opsSchemas.ts';

/** What one tool call sent and got back (Asha's tool_events, Munshi's owner_tool_events). */
export interface ToolEventLike {
  readonly tool: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly result: Readonly<Record<string, unknown>>;
  readonly durationMs: number | null;
  readonly createdAt: string;
}

export interface ToolText {
  readonly title: string;
  readonly note: string | null;
  /** A system failure (red) rather than a refusal the agent handles (amber). */
  readonly failed: boolean;
  readonly refused: boolean;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function money(value: unknown): string {
  return typeof value === 'number' ? formatInr(value) : '';
}

/** "2026-11-25" → "25 Nov"; blank when missing. */
function day(value: unknown): string {
  const iso = text(value);
  return iso ? shortDate(iso) : '';
}

/** The first sentence of a tool's "say" text, which is written for the agent. */
export function firstSentence(say: string): string | null {
  const match = /^(.+?[.!?])(\s|$)/.exec(say.trim());
  return (match?.[1] ?? say.trim()) || null;
}

/** Munshi's read-back, out of the instruction around it ("…ask "correct?": <read-back> Then stop"). */
export function readBack(say: string): string | null {
  const match = /correct\?"?:\s*(.+?)\s*Then stop/s.exec(say);
  return match?.[1] ?? null;
}

const STEP_TITLES: Readonly<Record<string, string>> = {
  call_queued: 'Call queued',
  call_accepted: 'Call connected',
  call_missed: 'Call not answered',
  call_ended: 'Call ended',
  owner_call_issued: 'Munshi call link sent to the owner',
  owner_call_accepted: 'Call connected',
  owner_call_ended: 'Call ended',
  call_url_refused: 'Call link refused',
  sarvam_url_failed: 'Sarvam would not start the call',
  call_not_authorised: 'Tool refused: call not authorised',
  owner_call_not_authorised: 'Tool refused: call not authorised',
  eval_side_effect_skipped: 'Test call: the real message was not sent',
  tone_judge: 'AI judged the tone',
  followup_run: 'Follow-up done',
  followup_agent: 'AI decided the follow-up',
  followup_note: 'AI wrote the note for the next call',
  owner_send_sent: 'Sent the owner a WhatsApp',
  daily_alert_sent: 'Daily due alert sent',
  promise_check: 'Checked promises that fell due',
  ops_alert: 'Failure alert sent',
  worker_job_failed: 'Background job failed',
  reminder_queued: 'Reminder call queued',
  brain_llm: 'AI read the message',
  whatsapp_send_failed: 'A WhatsApp reply failed to send',
  whatsapp_stranger: 'Message from an unknown number',
  langfuse_send_failed: 'Langfuse copy not sent',
};

function sentence(step: string): string {
  const words = step.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The step's plain name; whatsapp_message and request read their detail. */
export function stepTitle(step: TraceStep): string {
  const detail = step.detail;
  if (step.step === 'whatsapp_message') {
    if (step.status === 'error') return 'Handling the message failed';
    const replies = typeof detail['replies'] === 'number' ? detail['replies'] : 0;
    return `${plural(replies, 'reply', 'replies')} sent`;
  }
  if (step.step === 'owner_send_sent' && text(detail['what'])) {
    return `Sent the owner a WhatsApp (${text(detail['what'])})`;
  }
  if (step.step === 'followup_run' && text(detail['outcome']) !== 'done') {
    return `Follow-up: ${text(detail['outcome']).replace(/_/g, ' ') || 'not done'}`;
  }
  if (step.step === 'request') {
    const status = detail['http_status'];
    return step.status === 'error' ? `Request failed (HTTP ${String(status)})` : 'Message received';
  }
  return STEP_TITLES[step.step] ?? sentence(step.step);
}

/** A small grey line under some steps. */
export function stepNote(step: TraceStep): string | null {
  const detail = step.detail;
  if (step.step === 'whatsapp_message') {
    const how = text(detail['path']) === 'command' ? 'read in code' : 'read by AI';
    const command = text(detail['command']).replace(/_/g, ' ');
    return command ? `Understood as: ${command} (${how})` : null;
  }
  if (step.step === 'request')
    return step.status === 'error' ? text(detail['route']) || null : null;
  const error = text(detail['error']) || text(detail['reason']);
  return error ? error.replace(/_/g, ' ') : null;
}

/** Codes a Munshi or Asha tool gives back when it did not do the thing. */
const CODE_TEXT: Readonly<Record<string, string>> = {
  REPLACED_NOT_SAVED: 'Replaced by a newer read-back, nothing saved',
  WRONG_REF: 'Not the latest read-back, nothing saved',
  ALREADY_DONE: 'Already saved before, not saved twice',
  NO_OPEN_ACTION: 'Nothing was waiting for a yes, nothing saved',
  NOT_FOUND: 'name not in the book',
  DATE_IN_PAST: 'due date already past, nothing changed',
  NO_OPEN_CLAIM: 'no payment claim waiting',
  CALL_NOT_AUTHORISED: 'refused, call not authorised',
  INVALID_ARGS: 'the agent sent bad inputs',
  TEMPORARY_ERROR: 'failed, temporary error',
};
const SYSTEM_FAILURES = new Set(['CALL_NOT_AUTHORISED', 'INVALID_ARGS', 'TEMPORARY_ERROR']);
const CONFIRM_CODES = new Set([
  'REPLACED_NOT_SAVED',
  'WRONG_REF',
  'ALREADY_DONE',
  'NO_OPEN_ACTION',
]);

const TOOL_NOUN: Readonly<Record<string, string>> = {
  confirm_identity: 'Checked who answered',
  get_dues: 'Looked up the dues',
  log_promise: 'Save a promise',
  record_payment_claim: 'Note a payment claim',
  request_owner_callback: 'Asked the owner to call back',
  lookup_shopkeeper: 'Look up a shopkeeper',
  book_summary: 'Read the book',
  prepare_credit: 'Prepare a credit',
  prepare_payment: 'Prepare a payment',
  prepare_delete: 'Prepare a delete',
  prepare_remind: 'Prepare a reminder call',
  prepare_claim: 'Decide a payment claim',
  prepare_send: 'Prepare a WhatsApp',
  confirm_action: 'Save the change',
  cancel_action: 'Cancel the change',
};

function noun(tool: string): string {
  return TOOL_NOUN[tool] ?? sentence(tool);
}

function failedTool(tool: string, code: string): ToolText {
  const reason = CODE_TEXT[code] ?? `did not go through (${code || 'no code'})`;
  const title = CONFIRM_CODES.has(code) ? reason : `${noun(tool)}: ${reason}`;
  const failed = SYSTEM_FAILURES.has(code);
  return { title, note: null, failed, refused: !failed };
}

function ok(title: string, note: string | null = null): ToolText {
  return { title, note, failed: false, refused: false };
}

function ashaTool(event: ToolEventLike, say: string): ToolText | null {
  const { args } = event;
  const data = (event.result['data'] ?? {}) as Record<string, unknown>;
  switch (event.tool) {
    case 'confirm_identity': {
      const identity = text(data['identity'] ?? args['answer']);
      if (identity === 'confirmed') return ok('Checked who answered: the shopkeeper');
      if (identity === 'denied') return ok('Checked who answered: not the shopkeeper');
      return ok(identity ? `Checked who answered: ${identity}` : 'Checked who answered');
    }
    case 'get_dues':
      return ok('Looked up the dues', firstSentence(say));
    case 'log_promise':
      return ok(`Saved a promise: ${money(args['amount'])} on ${day(args['promise_date'])}`);
    case 'record_payment_claim': {
      const mode = text(args['mode']).toUpperCase();
      const when = day(args['paid_date']);
      return ok(`Noted a payment claim: ${money(args['amount'])} by ${mode} on ${when}`);
    }
    case 'request_owner_callback':
      return ok('Asked the owner to call back', text(args['reason']).replace(/_/g, ' ') || null);
    default:
      return null;
  }
}

function munshiTool(event: ToolEventLike, say: string): ToolText | null {
  const { args, tool } = event;
  if (tool.startsWith('prepare_')) {
    const back = readBack(say);
    return ok(back ? `Read back to owner: ${back}` : noun(tool));
  }
  switch (tool) {
    case 'lookup_shopkeeper':
      return ok(`Looked up ${text(args['name']) || 'a shopkeeper'}`, firstSentence(say));
    case 'book_summary':
      return ok(`Read the book (${text(args['focus']) || 'summary'})`, firstSentence(say));
    case 'confirm_action':
      return ok('Owner said yes, saved', firstSentence(say));
    case 'cancel_action':
      return ok('Owner said no, nothing saved');
    default:
      return null;
  }
}

/** The plain name of one tool call from what it sent and got back. */
export function toolText(event: ToolEventLike): ToolText {
  const say = text(event.result['say']);
  if (event.result['ok'] === false) return failedTool(event.tool, text(event.result['code']));
  return ashaTool(event, say) ?? munshiTool(event, say) ?? ok(noun(event.tool));
}

/** A tool step with no stored sent/got (older calls, or the event was not kept). */
export function bareToolText(tool: string, step: TraceStep): ToolText {
  if (step.detail['ok'] === false) return failedTool(tool, text(step.detail['code']));
  return ok(noun(tool));
}

const PROVIDERS: Readonly<Record<string, string>> = { sarvam: 'Sarvam', gemini: 'Gemini' };

export function providerName(provider: string): string {
  return PROVIDERS[provider] ?? provider;
}
