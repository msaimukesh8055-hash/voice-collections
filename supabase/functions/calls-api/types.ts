// supabase/functions/calls-api/types.ts
// Shared shapes for the app API's routes.
import type { ProxyDeps } from './sarvam-proxy.ts';

export interface CallsApiDeps extends ProxyDeps {
  /** Dashboard / phone page origins allowed to call the API from a browser. */
  readonly allowedOrigins: readonly string[];
}

export interface RouteContext {
  readonly deps: CallsApiDeps;
  readonly cors: HeadersInit;
  /** Path parameters captured by the route pattern, URL-decoded. */
  readonly params: readonly string[];
}

export type RouteHandler = (req: Request, ctx: RouteContext) => Promise<Response>;
