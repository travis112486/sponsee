import { randomUUID } from "node:crypto";

export const storageScopes = ["proofs", "contracts"] as const;
export type StorageScope = (typeof storageScopes)[number];

const KEY_PATTERN = /^creators\/([^/]+)\/deals\/([^/]+)\/[^/]+\/[^/]+$/;

/**
 * `creators/{creatorId}/deals/{dealId}/{scope}/{uuid}.{ext}` — the server
 * builds this, always. A client-supplied key would let one creator read or
 * overwrite another's object just by guessing/copying a path; embedding both
 * ids in the key is also what makes ownership verifiable later from the key
 * alone (see `keyBelongsToDeal`), with no extra lookup table.
 */
export function buildObjectKey(params: {
  creatorId: string;
  dealId: string;
  scope: StorageScope;
  extension: string;
}): string {
  return `creators/${params.creatorId}/deals/${params.dealId}/${params.scope}/${randomUUID()}.${params.extension}`;
}

/** Re-checked before every presigned GET — see proof.ts for the same pattern applied to deal ownership. */
export function keyBelongsToDeal(key: string, params: { creatorId: string; dealId: string }): boolean {
  const match = KEY_PATTERN.exec(key);
  if (!match) return false;
  return match[1] === params.creatorId && match[2] === params.dealId;
}

export function extensionFromKey(key: string): string | null {
  const match = /\.([a-zA-Z0-9]+)$/.exec(key);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Sanitizes a client-supplied filename for display (e.g. in a future
 * Content-Disposition or UI label) — never fed into the object key itself.
 * Strips any path component and anything outside a conservative allowlist so
 * it can't inject a header value, a path segment, or control characters.
 */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "";
  const cleaned = base.replace(/[^a-zA-Z0-9 ._-]/g, "").trim();
  return cleaned.slice(0, 200) || "file";
}
