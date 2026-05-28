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
  timeoutMs?: number;
}

export function parseJsonFromResponse(text: string): any {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    return JSON.parse(fenced[1].trim());
  }
  // Non-greedy bare matches first to handle multiple JSON blocks correctly.
  const objMatch = text.match(/\{[\s\S]*?\}/);
  const arrMatch = text.match(/\[[\s\S]*?\]/);
  if (arrMatch && (!objMatch || arrMatch.index! < objMatch.index!)) {
    return JSON.parse(arrMatch[0]);
  }
  if (objMatch) {
    // If non-greedy didn't capture a complete JSON object (truncated by inner braces),
    // fall back to greedy and let JSON.parse decide.
    try {
      return JSON.parse(objMatch[0]);
    } catch {
      const greedy = text.match(/\{[\s\S]*\}/);
      if (greedy) return JSON.parse(greedy[0]);
      throw new Error('No JSON found in response');
    }
  }
  throw new Error('No JSON found in response');
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  if (ms <= 0) return promise;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`subagent timeout after ${ms}ms`)), ms)),
  ]);
}

async function dispatchWithRetry<T = any>(
  prompt: string,
  dispatch: SubagentDispatcher,
  maxRetries: number,
  parseJson: boolean,
  timeoutMs: number,
): Promise<SubagentResult<T>> {
  let lastError = '';
  let lastAttempt = 0;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    lastAttempt = attempt;
    try {
      const raw = await withTimeout(dispatch(prompt), timeoutMs);
      const data = parseJson ? parseJsonFromResponse(raw) : raw;
      return { success: true, data, rawResponse: raw, retries: attempt };
    } catch (err: any) {
      lastError = err?.message ?? String(err);
      // Surface errors so they're not silently swallowed.
      console.warn(`[subagent] attempt ${attempt + 1}/${maxRetries} failed: ${lastError}`);
      const backoff = Math.pow(2, attempt) * 100;
      await new Promise(r => setTimeout(r, backoff));
    }
  }
  return { success: false, error: lastError, retries: lastAttempt };
}

export async function runSubagentBatch<T = any>(
  prompts: string[],
  dispatch: SubagentDispatcher,
  opts: SubagentBatchOptions = {},
): Promise<SubagentResult<T>[]> {
  const batchSize = opts.batchSize ?? 10;
  const maxRetries = opts.maxRetries ?? 3;
  const parseJson = opts.parseJson ?? true;
  // Default 5-minute timeout per dispatch. Pass 0 to disable.
  const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;

  if (batchSize <= 0) throw new Error(`batchSize must be > 0, got ${batchSize}`);
  if (maxRetries <= 0) throw new Error(`maxRetries must be > 0, got ${maxRetries}`);

  const results: SubagentResult<T>[] = [];
  for (let i = 0; i < prompts.length; i += batchSize) {
    const batch = prompts.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(p => dispatchWithRetry<T>(p, dispatch, maxRetries, parseJson, timeoutMs))
    );
    results.push(...batchResults);
  }
  return results;
}
