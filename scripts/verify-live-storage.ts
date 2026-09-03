// Manually-invoked, live-bucket verification of the storage module's
// presign/delete pipeline (SPO-354).
//
// The go-live 14/14 round trip against the real `sponsee-uploads` bucket
// (2026-09-02) was run from an ad-hoc script that was never committed — the
// only evidence left behind is a prose table in the SPO-155 runbook. This
// file is that script, committed, so it can be re-run the next time
// presign.ts or delete.ts changes.
//
// This is the "writes bytes" half of the go-live check. The read-only half
// (CORS preflight incl. the disallowed-origin control, bucket listing, the
// cross-creator signature-tamper test) already lives in the SPO-167 document
// "QA read-only re-verification probes for the live R2 bucket" and is not
// duplicated here beyond the two items (3, 8) that are cheap to keep next to
// the checks that actually write and delete.
//
// Deliberately NOT a vitest suite and NOT wired into CI — see SPO-171's
// `storage-e2e` job, which stays on MinIO. This one needs production
// credentials and writes real objects to the live bucket, so it runs by hand:
//
//   source ~/.config/infisical-agent/credentials.env
//   export INFISICAL_TOKEN=$(infisical login --method=universal-auth \
//     --client-id="$INFISICAL_CLIENT_ID" --client-secret="$INFISICAL_CLIENT_SECRET" --plain --silent)
//   for k in STORAGE_ENDPOINT STORAGE_BUCKET STORAGE_REGION STORAGE_ACCESS_KEY_ID STORAGE_SECRET_ACCESS_KEY; do
//     export $k="$(infisical secrets get $k --projectId "$INFISICAL_PROJECT_ID" --env prod --plain --silent)"
//   done
//   pnpm verify:live-storage
//
// Run this before/after touching presign.ts or delete.ts, and at go-live.
import { createHash, randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import {
  buildS3Client,
  createDownloadUrl,
  createUploadUrl,
  deleteObject,
  getStorageConfig,
  type StorageConfig,
  type StorageScope,
} from "../apps/api/src/storage/index.js";

const REQUIRED_VARS = [
  "STORAGE_ENDPOINT",
  "STORAGE_BUCKET",
  "STORAGE_REGION",
  "STORAGE_ACCESS_KEY_ID",
  "STORAGE_SECRET_ACCESS_KEY",
] as const;

const ALLOWED_ORIGIN = process.env.VERIFY_STORAGE_ALLOWED_ORIGIN ?? "https://sponsee.vercel.app";
const DISALLOWED_ORIGIN = "https://evil.example.com";

function loadEnv(): Record<string, string> {
  const missing = REQUIRED_VARS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `verify-live-storage.ts needs live bucket credentials. Missing env: ${missing.join(", ")}.\n` +
        "Load the five STORAGE_* vars from Infisical prod (see this file's header comment) and re-run."
    );
  }
  return Object.fromEntries(REQUIRED_VARS.map((key) => [key, process.env[key] as string]));
}

// Same tiny fixtures storage.e2e.test.ts uses against MinIO — a real PNG and
// a real (if minimal) PDF, so content-type sniffing and disposition checks
// exercise genuine file bytes rather than opaque filler.
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);
const PDF_BYTES = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 3 3]>>endobj\nxref\n0 4\n0000000000 65535 f \n" +
    "trailer<</Size 4/Root 1 0 R>>\n%%EOF",
  "utf-8"
);

const FIXTURES: Record<StorageScope, { mimeType: string; filename: string; bytes: Buffer }> = {
  proofs: { mimeType: "image/png", filename: "verify-live-storage.png", bytes: PNG_BYTES },
  contracts: { mimeType: "application/pdf", filename: "verify-live-storage.pdf", bytes: PDF_BYTES },
};

interface CheckResult {
  item: string;
  description: string;
  scope?: string;
  pass: boolean;
  detail: string;
}

const results: CheckResult[] = [];

function check(item: string, description: string, scope: string | undefined, pass: boolean, detail: string): void {
  results.push({ item, description, scope, pass, detail });
  const scopeLabel = scope ? `[${scope}] ` : "";
  console.log(`${pass ? "PASS" : "FAIL"}  item ${item} ${scopeLabel}${description} — ${detail}`);
}

function skip(item: string, description: string, scope: string | undefined, reason: string): void {
  check(item, description, scope, false, `SKIPPED — ${reason}`);
}

async function preflight(env: Record<string, string>, origin: string): Promise<Response> {
  const endpoint = env.STORAGE_ENDPOINT.replace(/\/$/, "");
  const url = `${endpoint}/${env.STORAGE_BUCKET}/verify-live-storage-preflight-probe`;
  return fetch(url, {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "PUT",
      "Access-Control-Request-Headers": "content-type",
    },
  });
}

async function verifyCors(env: Record<string, string>): Promise<void> {
  const allowed = await preflight(env, ALLOWED_ORIGIN);
  const allowOrigin = allowed.headers.get("access-control-allow-origin");
  check(
    "3",
    "CORS preflight from the real web origin returns 204 with allow-origin echoed",
    undefined,
    allowed.status === 204 && allowOrigin === ALLOWED_ORIGIN,
    `HTTP ${allowed.status}, allow-origin=${allowOrigin ?? "none"}`
  );

  const disallowed = await preflight(env, DISALLOWED_ORIGIN);
  const disallowedOrigin = disallowed.headers.get("access-control-allow-origin");
  check(
    "8",
    "CORS preflight from a disallowed origin returns 403 with no allow headers",
    undefined,
    disallowed.status === 403 && !disallowedOrigin,
    `HTTP ${disallowed.status}, allow-origin=${disallowedOrigin ?? "none"}`
  );
}

/**
 * Runs items 1, 2, 4, 5, 6, 7, 9 for one scope. Uploads a real object,
 * verifies it end to end, then deletes it — `createdKeys` also gets it, so
 * the final cleanup pass deletes it again (harmless — DeleteObject on an
 * absent key is not an error) in case any step here throws before reaching
 * the delete.
 */
async function verifyScope(
  env: Record<string, string>,
  scope: StorageScope,
  creatorId: string,
  dealId: string,
  otherCreatorId: string,
  createdKeys: string[]
): Promise<void> {
  const fixture = FIXTURES[scope];
  const expectedSha256 = createHash("sha256").update(fixture.bytes).digest("hex");

  const upload = await createUploadUrl({
    creatorId,
    dealId,
    scope,
    mimeType: fixture.mimeType,
    sizeBytes: fixture.bytes.length,
    filename: fixture.filename,
    env,
  });
  createdKeys.push(upload.key);

  const uploadUrl = new URL(upload.url);
  const checksumParam = [...uploadUrl.searchParams.keys()].find((key) => /checksum/i.test(key));
  check(
    "1",
    "presigned PUT URL carries no checksum params",
    scope,
    !checksumParam,
    checksumParam ? `found query param ${checksumParam}` : "no checksum-related query params"
  );

  const signedHeaders = uploadUrl.searchParams.get("X-Amz-SignedHeaders");
  check(
    "2",
    "signed headers are browser-supplyable (content-length;host)",
    scope,
    signedHeaders === "content-length;host",
    `X-Amz-SignedHeaders=${signedHeaders ?? "missing"}`
  );

  const putRes = await fetch(upload.url, {
    method: "PUT",
    headers: upload.requiredHeaders,
    body: new Uint8Array(fixture.bytes),
  });
  check("4", "presigned PUT returns 200", scope, putRes.status === 200, `HTTP ${putRes.status}`);
  if (!putRes.ok) {
    skip("5", "presigned GET round-trips with a matching sha256", scope, "PUT did not succeed");
    skip("6", "inline disposition + correct content-type on the download", scope, "PUT did not succeed");
    skip("7", "deleteObject really removes the object (404 after)", scope, "PUT did not succeed");
    skip("9", "cross-creator signature replay returns 403 SignatureDoesNotMatch", scope, "PUT did not succeed");
    return;
  }

  const download = await createDownloadUrl({ key: upload.key, env });
  const getRes = await fetch(download.url);
  const body = Buffer.from(await getRes.arrayBuffer());
  const actualSha256 = createHash("sha256").update(body).digest("hex");
  check(
    "5",
    "presigned GET round-trips with a matching sha256",
    scope,
    getRes.ok && actualSha256 === expectedSha256,
    `HTTP ${getRes.status}, sha256 ${actualSha256 === expectedSha256 ? "matches" : `MISMATCH (expected ${expectedSha256}, got ${actualSha256})`}`
  );

  const contentType = getRes.headers.get("content-type");
  const disposition = getRes.headers.get("content-disposition") ?? "";
  check(
    "6",
    "inline disposition + correct content-type on the download",
    scope,
    contentType === fixture.mimeType && disposition.startsWith("inline;"),
    `content-type=${contentType ?? "missing"}, content-disposition=${disposition || "missing"}`
  );

  // Same shape as the presign, key path swapped to a creator who never
  // uploaded anything — the signature was computed over creatorId's original
  // path, so this must fail closed regardless of whether the tampered key
  // exists.
  const tamperedKey = upload.key.replace(`creators/${creatorId}/`, `creators/${otherCreatorId}/`);
  const tamperedUrl = download.url.replace(upload.key, tamperedKey);
  const tamperRes = await fetch(tamperedUrl);
  const tamperBody = await tamperRes.text();
  check(
    "9",
    "cross-creator signature replay returns 403 SignatureDoesNotMatch",
    scope,
    tamperRes.status === 403 && tamperBody.includes("SignatureDoesNotMatch"),
    `HTTP ${tamperRes.status}`
  );

  await deleteObject(upload.key, env);
  const postDeleteRes = await fetch(download.url);
  check(
    "7",
    "deleteObject really removes the object (404 after)",
    scope,
    postDeleteRes.status === 404,
    `HTTP ${postDeleteRes.status}`
  );
}

async function main(): Promise<void> {
  const env = loadEnv();
  const config = getStorageConfig(env) as StorageConfig;
  const client = buildS3Client(config);

  const runId = randomUUID();
  const dealId = randomUUID();
  // Never uploaded to — exists only to build a same-shape but differently-
  // owned key for the item-9 tamper test.
  const otherCreatorId = randomUUID();
  const createdKeys: string[] = [];

  try {
    for (const scope of ["proofs", "contracts"] as const) {
      try {
        await verifyScope(env, scope, runId, dealId, otherCreatorId, createdKeys);
      } catch (err) {
        check("scope-error", `unexpected error verifying scope`, scope, false, err instanceof Error ? err.message : String(err));
      }
    }

    try {
      await verifyCors(env);
    } catch (err) {
      check("cors-error", "unexpected error running CORS preflight checks", undefined, false, err instanceof Error ? err.message : String(err));
    }
  } finally {
    console.log("\nCleaning up...");
    for (const key of createdKeys) {
      try {
        await deleteObject(key, env);
      } catch (err) {
        console.error(`  cleanup: failed to delete ${key}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const listing = await client.send(
      new ListObjectsV2Command({ Bucket: config.bucket, Prefix: `creators/${runId}/` })
    );
    const keyCount = listing.KeyCount ?? 0;
    check(
      "cleanup",
      "own prefix is empty after cleanup (KeyCount 0)",
      undefined,
      keyCount === 0,
      `KeyCount=${keyCount} for prefix creators/${runId}/`
    );
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length > 0) {
    console.log("\nFailed checks:");
    for (const f of failed) {
      console.log(`  - item ${f.item}${f.scope ? ` [${f.scope}]` : ""}: ${f.description} — ${f.detail}`);
    }
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exitCode = 1;
});
