export type SubagentDispatcher = (prompt: string) => Promise<string>;

export interface SubagentResult<T = any> {
  success: boolean;
  data?: T;
  rawResponse?: string;
  error?: string;
  retries: number;
}

export interface SubagentBatchOptions {
  batchSize?: number;
  maxRetries?: number;
  parseJson?: boolean;
}

export function parseJsonFromResponse(text: string): any {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    return JSON.parse(fenced[1].trim());
  }
  const objMatch = text.match(/\{[\s\S]*\}/);
  const arrMatch = text.match(/\[[\s\S]*\]/);
  if (arrMatch && (!objMatch || arrMatch.index! < objMatch.index!)) {
    return JSON.parse(arrMatch[0]);
  }
  if (objMatch) {
    return JSON.parse(objMatch[0]);
  }
  throw new Error('No JSON found in response');
}

async function dispatchWithRetry<T = any>(
  prompt: string,
  dispatch: SubagentDispatcher,
  maxRetries: number,
  parseJson: boolean,
): Promise<SubagentResult<T>> {
  let lastError = '';
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const raw = await dispatch(prompt);
      const data = parseJson ? parseJsonFromResponse(raw) : raw;
      return { success: true, data, rawResponse: raw, retries: attempt };
    } catch (err: any) {
      lastError = err?.message ?? String(err);
      // Shorter backoff for retries -- 100ms exponential keeps tests fast.
      const backoff = Math.pow(2, attempt) * 100;
      await new Promise(r => setTimeout(r, backoff));
    }
  }
  return { success: false, error: lastError, retries: maxRetries - 1 };
}

export async function runSubagentBatch<T = any>(
  prompts: string[],
  dispatch: SubagentDispatcher,
  opts: SubagentBatchOptions = {},
): Promise<SubagentResult<T>[]> {
  const batchSize = opts.batchSize ?? 10;
  const maxRetries = opts.maxRetries ?? 3;
  const parseJson = opts.parseJson ?? true;

  const results: SubagentResult<T>[] = [];
  for (let i = 0; i < prompts.length; i += batchSize) {
    const batch = prompts.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(p => dispatchWithRetry<T>(p, dispatch, maxRetries, parseJson))
    );
    results.push(...batchResults);
  }
  return results;
}
