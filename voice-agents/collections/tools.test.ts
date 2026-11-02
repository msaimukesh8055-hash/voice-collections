// voice-agents/collections/tools.test.ts
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { PAYMENT_MODES } from '../../supabase/functions/_shared/compliance/promise-policy.ts';
import { TOOL_NAMES, TOOL_SPECS } from '../../supabase/functions/_shared/tools/schemas.ts';
import { FunctionToolSchema } from '../schema.ts';
import { COLLECTIONS_TOOLS } from './tools.ts';

function toolNamed(name: string): (typeof COLLECTIONS_TOOLS)[number] {
  const tool = COLLECTIONS_TOOLS.find((candidate) => candidate.function.name === name);
  if (!tool) throw new Error(`missing tool ${name}`);
  return tool;
}

describe('COLLECTIONS_TOOLS', () => {
  it('defines exactly the tools the server registry knows', () => {
    expect(COLLECTIONS_TOOLS.map((tool) => tool.function.name)).toEqual(TOOL_NAMES);
  });

  it.each(TOOL_NAMES)('%s parameters match the server Zod schema', (name) => {
    // toEqual ignores undefined properties, so this compares everything except `$schema`.
    const expected = { ...z.toJSONSchema(TOOL_SPECS[name].args), $schema: undefined };
    expect(toolNamed(name).function.parameters).toEqual(expected);
    expect(toolNamed(name).function.description).toBe(TOOL_SPECS[name].description);
  });

  it('is valid Vapi function-tool shape without a $schema marker', () => {
    for (const tool of COLLECTIONS_TOOLS) {
      expect(FunctionToolSchema.safeParse(tool).success).toBe(true);
      expect(tool.function.parameters).not.toHaveProperty('$schema');
    }
  });

  it('log_promise_to_pay requires amount, date and one of the allowed payment modes', () => {
    const parameters = toolNamed('log_promise_to_pay').function.parameters as {
      required: string[];
      properties: { paymentMode: { enum: string[] } };
    };
    expect(parameters.required).toEqual(['amount', 'promiseDate', 'paymentMode']);
    expect(parameters.properties.paymentMode.enum).toEqual([...PAYMENT_MODES]);
  });

  it('no tool accepts a customer identifier (identity comes from the call token)', () => {
    expect(JSON.stringify(COLLECTIONS_TOOLS)).not.toMatch(/customer_?id|loan_?id|phone/i);
  });
});
