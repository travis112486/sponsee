/**
 * Minimal fetch wrapper with retry/backoff for platform APIs.
 * Retries on 429 and 5xx with exponential backoff; throws on other failures.
 */

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export async function fetchJson<T>(
  url: string,
  init: RequestInit = {},
  retries = 2,
  backoffMs = 500
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, backoffMs * 2 ** (attempt - 1)));
    }

    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (err) {
      lastError = err as Error;
      continue; // network error — retry
    }

    if (res.ok) {
      return (await res.json()) as T;
    }

    const body = await res.text().catch(() => "");
    lastError = new Error(`${res.status} ${res.statusText}: ${body.slice(0, 300)}`);
    if (!RETRYABLE.has(res.status)) {
      throw lastError;
    }
  }

  throw lastError ?? new Error("fetchJson failed");
}

/**
 * True for auth-shaped upstream failures (401/403). Keys off the status prefix
 * fetchJson puts on its errors; on the connected sync path these mean the
 * broadcaster token no longer works and the fix is a reconnect, not a retry.
 */
export function isAuthError(err: unknown): boolean {
  return err instanceof Error && /^40[13] /.test(err.message);
}
