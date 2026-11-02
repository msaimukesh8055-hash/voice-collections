// scripts/lib/agent-render.ts
// Validates an agent config and renders the JSON the coordinator pushes to Sarvam with the MCP
// connector (Sarvam has no public config API). Tool URLs point at our Supabase functions; the
// bearer secret is referenced by its Sarvam vault name, never by value.
import { createHash } from 'node:crypto';
import { type AgentConfig, AgentConfigSchema, type ApiTool } from '../../voice-agents/schema.ts';

export interface RenderedTool extends Omit<ApiTool, 'path'> {
  readonly url: string;
  readonly auth: { readonly type: 'bearer'; readonly secretName: string };
  readonly headers: Readonly<Record<string, string>>;
}

export interface RenderedAgent extends Omit<AgentConfig, 'tools' | 'toolSecretName'> {
  readonly tools: readonly RenderedTool[];
  /** sha256 of everything Sarvam receives; stored in `publishes` to tie a version to the code. */
  readonly configHash: string;
}

const FUNCTIONS_URL_PATTERN = /^https:\/\/[^/]+\/functions\/v1$/;

function renderTool(tool: ApiTool, functionsUrl: string, secretName: string): RenderedTool {
  const { path, ...rest } = tool;
  // No static headers: the functions run in Mumbai next to Sarvam, so no region pinning.
  return {
    ...rest,
    url: `${functionsUrl}${path}`,
    auth: { type: 'bearer', secretName },
    headers: {},
  };
}

export function hashConfig(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** `functionsUrl` is e.g. https://<ref>.supabase.co/functions/v1 (no trailing slash). */
export function renderAgent(config: AgentConfig, functionsUrl: string): RenderedAgent {
  const valid = AgentConfigSchema.parse(config);
  if (!FUNCTIONS_URL_PATTERN.test(functionsUrl)) {
    throw new Error('functionsUrl must look like https://<ref>.supabase.co/functions/v1');
  }
  const { tools, toolSecretName, ...agent } = valid;
  const body = {
    ...agent,
    tools: tools.map((tool) => renderTool(tool, functionsUrl, toolSecretName)),
  };
  return { ...body, configHash: hashConfig(body) };
}
