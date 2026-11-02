// supabase/functions/_shared/errors.ts

/** Client-facing error catalogue. Detailed causes are logged server-side only. */
export const ERROR_CODES = {
  BAD_REQUEST: { status: 400, message: 'The request was invalid.' },
  UNAUTHORIZED: { status: 401, message: 'Authentication failed.' },
  FORBIDDEN: { status: 403, message: 'This action is not allowed.' },
  NOT_FOUND: { status: 404, message: 'The requested record was not found.' },
  METHOD_NOT_ALLOWED: { status: 405, message: 'This method is not allowed.' },
  NOT_VERIFIED: { status: 403, message: 'Customer identity has not been verified.' },
  DO_NOT_CALL: { status: 409, message: 'This customer has asked not to be called.' },
  OUTSIDE_CALLING_HOURS: {
    status: 409,
    message: 'Calls are only allowed between 08:00 and 19:00 IST.',
  },
  ATTEMPT_LIMIT_REACHED: { status: 409, message: 'The call attempt limit has been reached.' },
  RATE_LIMITED: { status: 429, message: 'Too many requests. Please retry later.' },
  INTERNAL: { status: 500, message: 'Something went wrong. Please try again.' },
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
