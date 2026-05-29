import type { AiInvoker } from './_bridge_writer';
import { openRouterInvoke } from './_ai_subagent';
import { makeFileBasedInvoker } from './_file_based_invoker';
import { logApiCall } from './_api_logger';

export function makeOpenRouterInvoker(
  apiKey: string,
  model = 'anthropic/claude-haiku-4-5',
): AiInvoker {
  return async (prompt: string, _context?: { person_id?: string }): Promise<string> => {
    try {
      const result = await openRouterInvoke(prompt, apiKey, model);
      logApiCall({
        provider: 'openrouter',
        script: 'run-pipeline.ts',
        operation: `bridge/${model}`,
        units: 1,
        unit_type: 'calls',
      });
      return result;
    } catch {
      return '';
    }
  };
}

export function makeAutoInvoker(
  openRouterKey: string | undefined,
  responsesDir: string,
): AiInvoker {
  if (openRouterKey) {
    return makeOpenRouterInvoker(openRouterKey);
  }
  return makeFileBasedInvoker(responsesDir);
}
