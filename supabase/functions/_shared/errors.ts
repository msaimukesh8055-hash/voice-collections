// supabase/functions/_shared/errors.ts

/** Client-facing error catalogue. Detailed causes are logged server-side only. */
export const ERROR_CODES = {
  BAD_REQUEST: { status: 400, message: 'The request was invalid.' },
  UNAUTHORIZED: { status: 401, message: 'Authentication failed.' },
  FORBIDDEN: { status: 403, message: 'This action is not allowed.' },
  NOT_FOUND: { status: 404, message: 'The requested record was not found.' },
  METHOD_NOT_ALLOWED: { status: 405, message: 'This method is not allowed.' },
  CALL_STATE_CONFLICT: { status: 409, message: 'This call can no longer do that.' },
  NO_LIVE_SHOPKEEPER: { status: 409, message: 'No live shopkeeper is set for the demo.' },
  CALLS_PAUSED: { status: 409, message: 'Reminder calls are paused.' },
  DO_NOT_CALL: { status: 409, message: 'This shopkeeper has asked not to be called.' },
  OUTSIDE_CALLING_HOURS: {
    status: 409,
    message: 'Calls are only allowed between 08:00 and 19:00 IST.',
  },
  ATTEMPT_LIMIT_REACHED: { status: 409, message: 'The call attempt limit has been reached.' },
  RATE_LIMITED: { status: 429, message: 'Too many requests. Please retry later.' },
  INTERNAL: { status: 500, message: 'Something went wrong. Please try again.' },
  UPSTREAM_ERROR: { status: 502, message: 'The voice service did not answer. Please try again.' },
  VOICE_NOT_CONFIGURED: { status: 503, message: 'The voice agent is not set up yet.' },
} as const satisfies Record<string, { status: number; message: string }>;

export type ErrorCode = keyof typeof ERROR_CODES;

export interface ClientError {
  readonly code: ErrorCode;
  readonly message: string;
  readonly status: number;
}

export function toClientError(code: ErrorCode): ClientError {
  const { status, message } = ERROR_CODES[code];
  return { code, message, status };
}
