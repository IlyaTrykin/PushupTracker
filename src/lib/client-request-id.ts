/**
 * Idempotency keys of create requests from the browser (B04): a request re-sent with the same
 * input after a network failure carries the same `clientRequestId`, so the server returns the
 * record it may already have created instead of a duplicate.
 */

export function newClientRequestId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {}
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** The id of a request that has not been answered yet, and the input it was sent with. */
export type PendingClientRequest = { id: string; signature: string };

/** The request to send for `signature`: the pending one when the same input is sent again, otherwise a new id. */
export function clientRequestFor(pending: PendingClientRequest | null, signature: string): PendingClientRequest {
  if (pending && pending.signature === signature) return pending;
  return { id: newClientRequestId(), signature };
}

/**
 * What stays pending after a failed request: a network failure (`TypeError` from fetch) keeps the
 * id — the record may have been created; a server answer (4xx/5xx) means it was not, so the id is dropped.
 */
export function pendingAfterFailure(pending: PendingClientRequest | null, error: unknown): PendingClientRequest | null {
  return error instanceof TypeError ? pending : null;
}
