import { logApiCall } from './_api_logger';

export interface SerperResult {
  raw: any;
  queryString: string;
  timestamp: string;
  status: number;
  fromCache?: boolean;  // true when result was replayed from sidecar fetch_log
}

export async function serperSearch(query: string, apiKey: string, callerScript = 'unknown', retries = 3): Promise<SerperResult> {
  const url = 'https://google.serper.dev/search';
  let lastStatus = 0;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'X-API-KEY': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ q: query, gl: 'us' }),
      });

      lastStatus = res.status;

      if (res.ok) {
        const raw = await res.json();
        logApiCall({ provider: 'serper', script: callerScript, operation: 'serperSearch', units: 1, unit_type: 'credits' });
        return {
          raw,
          queryString: query,
          timestamp: new Date().toISOString(),
          status: res.status,
        };
      }

      if (res.status === 429 || res.status >= 500) {
        const backoff = Math.pow(2, attempt) * 500;
        await new Promise(r => setTimeout(r, backoff));
        continue;
      }

      throw new Error(`Serper non-retryable error ${res.status}`);
    } catch (err: any) {
      // Network-level error (ECONNREFUSED, ENOTFOUND, etc.) — retry with backoff
      if (err.message?.includes('non-retryable')) throw err;
      const backoff = Math.pow(2, attempt) * 1000;
      await new Promise(r => setTimeout(r, backoff));
    }
  }

  throw new Error(`Serper rate limit / server error after ${retries} retries (last status: ${lastStatus})`);
}
