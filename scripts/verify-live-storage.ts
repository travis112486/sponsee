/**
 * Live-bucket verification for the storage module. MANUALLY INVOKED — never CI.
 *
 *   pnpm verify:live-storage
 *
 * This is the write-bytes half of the go-live storage check. It drives the
 * application's own `presign.ts` / `delete.ts` against whatever bucket the
 * five `STORAGE_*` vars point at — in practice production `sponsee-uploads`
 * on Cloudflare R2 — and asserts the ten properties that gated go-live, for
 * both the `proofs` and `contracts` scopes.
 *
 * WHY THIS IS NOT A CI JOB. `storage.e2e.test.ts` (SPO-171, the `storage-e2e`
 * job) covers the same code paths against MinIO and stays where it is. This
 * script needs *production* credentials and writes real objects to the live
 * bucket; wiring it into CI would put prod secrets in the CI environment for
 * no added coverage. Run it by hand before and after any change to
 * `presign.ts`, `client.ts` or `delete.ts`, and at go-live.
 *
 * WHY IT EXISTS AT ALL. The original 14/14 go-live run (2026-09-02) came from
 * an ad-hoc script that was never committed, so its result survived only as a
 * prose table in the SPO-155 runbook — unre-runnable, and blind to the next
 * regression in the presigner. That is exactly the class of bug SPO-351 was
 * about: `WHEN_REQUIRED` checksum config (see client.ts) is invisible to MinIO
 * and only R2/S3 reject the mismatch. See SPO-354.
 *
 * TWO NEGATIVE CONTROLS the original run did not include are checks 8 and 9.
 * QA verified both by hand during SPO-167; they are cheap to keep and they are
 * the only checks here that would catch a bucket-policy regression rather than
 * an application one.
 *
 * CHECK 10 closes the coverage gap QA found reviewing this script: the 25 MB
 * size cap is advisory unless the bucket enforces the signed `Content-Length`,
 * and that property was proven only against MinIO. It is now proven against
 * the bucket that actually holds creator evidence.
 *
 * SAFETY. Every object this writes lives under a single freshly-generated
 * `creators/{uuid}/` prefix, and the only key ever passed to `deleteObject` is
 * one this run created. It cannot touch a real creator's evidence, the SPO-355
 * lifecycle canary under `_ops/`, or anything else already in the bucket.
 * Cleanup runs even when a check fails, and the final check asserts a
 * `KeyCount` of 0 for the run's own prefix.
 *
 * HOW TO GET CREDENTIALS (prod, from Infisical — same incantation the QA
 * read-only probes on SPO-167 document):
 *
 *   source ~/.config/infisical-agent/credentials.env
 *   export INFISICAL_TOKEN=$(infisical login --method=universal-auth \
 *     --client-id="$INFISICAL_CLIENT_ID" --client-secret="$INFISICAL_CLIENT_SECRET" \
 *     --plain --silent)
 *   for k in STORAGE_ENDPOINT STORAGE_BUCKET STORAGE_REGION \
 *            STORAGE_ACCESS_KEY_ID STORAGE_SECRET_ACCESS_KEY; do
 *     export $k="$(infisical secrets get $k --projectId "$INFISICAL_PROJECT_ID" \
 *       --env prod --plain --silent)"
 *   done
 *   pnpm verify:live-storage
 *
 * Exit 0 = every check passed. Exit 1 = at least one failed, or the run could
 * not be completed. There is no "skip" path: a verification that can report a
 * green without having reached the wire is worse than no verification.
 */
import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { buildS3Client } from "../apps/api/src/storage/client.js";
import { getStorageConfig, type StorageConfig } from "../apps/api/src/storage/config.js";
import { deleteObject } from "../apps/api/src/storage/delete.js";
import type { StorageScope } from "../apps/api/src/storage/keys.js";
import { createDownloadUrl, createUploadUrl } from "../apps/api/src/storage/presign.js";

const REQUIRED_VARS = [
  "STORAGE_ENDPOINT",
  "STORAGE_BUCKET",
  "STORAGE_REGION",
  "STORAGE_ACCESS_KEY_ID",
  "STORAGE_SECRET_ACCESS_KEY",
] as const;

/** The origin the deployed web app actually presigns and PUTs from. */
const ALLOWED_ORIGIN = "https://sponsee.vercel.app";
/** Negative control for check 8 — must never appear in the bucket's CORS allowlist. */
const DISALLOWED_ORIGIN = "https://evil.example.com";

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

interface ScopeFixture {
  scope: StorageScope;
  mimeType: string;
  extension: string;
  filename: string;
  /**
   * `Uint8Array<ArrayBuffer>` rather than a bare `Uint8Array`: since TS 5.7 the
   * element type is generic, and `fetch`'s `BodyInit` only accepts the
   * `ArrayBuffer`-backed instantiation. `Buffer.from` already returns exactly
   * that. (Found by `pnpm typecheck:scripts` — this file compiled nowhere
   * before that existed.)
   */
  bytes: Uint8Array<ArrayBuffer>;
}

// Both allowlisted content classes, because the download path branches on them:
// `createDownloadUrl` derives Content-Type and inline-vs-attachment from the
// key's own extension, so a PNG and a PDF exercise two different lookups.
const FIXTURES: ScopeFixture[] = [
  { scope: "proofs", mimeType: "image/png", extension: "png", filename: "verify-proof.png", bytes: PNG_BYTES },
  {
    scope: "contracts",
    mimeType: "application/pdf",
    extension: "pdf",
    filename: "verify-contract.pdf",
    bytes: PDF_BYTES,
  },
];

interface CheckResult {
  n: number;
  scope: string;
  name: string;
  ok: boolean;
  detail: string;
}

const results: CheckResult[] = [];

function record(n: number, scope: string, name: string, ok: boolean, detail: string): boolean {
  results.push({ n, scope, name, ok, detail });
  const mark = ok ? "PASS" : "FAIL";
  console.log(`  ${mark}  ${String(n).padStart(2)}. [${scope}] ${name} — ${detail}`);
  return ok;
}

function loadEnv(): Record<string, string> {
  const missing = REQUIRED_VARS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error(
      `verify-live-storage needs live bucket credentials. Missing env: ${missing.join(", ")}.\n` +
        "See the header comment in scripts/verify-live-storage.ts for the Infisical incantation."
    );
    process.exit(1);
  }
  return Object.fromEntries(REQUIRED_VARS.map((key) => [key, process.env[key] as string]));
}

function sha256(bytes: Buffer | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Strips the SigV4 query string — the URL a browser would send its preflight to. */
function objectUrlOf(presignedUrl: string): string {
  const url = new URL(presignedUrl);
  url.search = "";
  return url.toString();
}

/** S3/R2 error bodies are XML; the `<Code>` is the part worth asserting on. */
function errorCodeOf(body: string): string {
  const match = /<Code>([^<]+)<\/Code>/.exec(body);
  return match ? match[1] : body.slice(0, 80).replace(/\s+/g, " ").trim() || "(empty body)";
}

/**
 * Drops a key from the cleanup list — only ever called once the bucket has been
 * *observed* not to hold it. Optimistically forgetting a key right after
 * issuing the delete would disarm cleanup in exactly the case cleanup exists
 * for: a delete that returned without throwing but did not land.
 */
function forget(keys: string[], key: string): void {
  const index = keys.indexOf(key);
  if (index >= 0) keys.splice(index, 1);
}

/** Is this key readable in the bucket right now? Goes through the app's own read path. */
async function stillStored(key: string, filename: string, env: Record<string, string>): Promise<{ present: boolean; detail: string }> {
  const { url } = await createDownloadUrl({ key, filename, env });
  const res = await fetch(url);
  if (res.status === 200) return { present: true, detail: "200 (still readable)" };
  if (res.status === 404) return { present: false, detail: `404 ${errorCodeOf(await res.text())}` };
  // Anything else (403, 5xx) is not proof of absence — keep the key on the
  // cleanup list rather than assume it away.
  return { present: true, detail: `${res.status} ${errorCodeOf(await res.text())}` };
}

async function preflight(
  objectUrl: string,
  origin: string,
  method: string
): Promise<{ status: number; allowOrigin: string | null; allowMethods: string | null; allowHeaders: string | null }> {
  const res = await fetch(objectUrl, {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": method,
      // Matches what the browser will actually preflight: `Content-Type` is
      // the one non-safelisted header in `PresignedUpload.requiredHeaders`
      // (`Content-Length` is CORS-safelisted and needs no allowlist entry).
      "Access-Control-Request-Headers": "content-type",
    },
  });
  return {
    status: res.status,
    allowOrigin: res.headers.get("access-control-allow-origin"),
    allowMethods: res.headers.get("access-control-allow-methods"),
    allowHeaders: res.headers.get("access-control-allow-headers"),
  };
}

async function verifyScope(fixture: ScopeFixture, ids: { creatorId: string; dealId: string }, env: Record<string, string>) {
  const { scope, mimeType, extension, filename, bytes } = fixture;
  const tag = scope;

  const upload = await createUploadUrl({
    creatorId: ids.creatorId,
    dealId: ids.dealId,
    scope,
    mimeType,
    sizeBytes: bytes.length,
    filename,
    env,
  });
  const createdKeys: string[] = [upload.key];

  try {
    const putParams = new URL(upload.url).searchParams;

    // 1. No checksum params. The regression SPO-351 documented: the SDK
    //    default (`WHEN_SUPPORTED`, since 3.729) puts a CRC32 of the *empty*
    //    body into the presigned PUT's query string, because there is no body
    //    yet at sign time. `client.ts` sets `WHEN_REQUIRED` to prevent it.
    //
    //    This check is load-bearing on its own, and measurably more so than
    //    the code comments assume. Deleting the two `WHEN_REQUIRED` lines from
    //    `client.ts` and re-running this script against live R2 on 2026-09-03
    //    failed *only* here: `x-amz-checksum-crc32` and
    //    `x-amz-sdk-checksum-algorithm` reappeared in the URL, and R2 then
    //    accepted the PUT with 200 and round-tripped the bytes intact
    //    (checks 4-7 all still passed). So the claim in `client.ts` that "AWS
    //    S3 and R2 both validate that mismatch and reject the PUT with 400"
    //    does not hold for R2 under the SDK version pinned today — nothing at
    //    the wire catches a reintroduction, on R2 or on MinIO. Asserting on
    //    the URL's shape is the only thing that does.
    const checksumParams = [...putParams.keys()].filter((k) => /checksum/i.test(k));
    record(
      1,
      tag,
      "presigned PUT URL carries no checksum params",
      checksumParams.length === 0,
      checksumParams.length === 0 ? "no checksum query params" : `found: ${checksumParams.join(", ")}`
    );

    // 2. Signed headers must be ones a browser will set on its own. Anything
    //    beyond `content-length;host` (an `x-amz-*` header, say) cannot be
    //    supplied from `fetch()` in a page and would make the URL unusable
    //    from the client even though it works from a server-side test.
    const signedHeaders = putParams.get("X-Amz-SignedHeaders");
    record(
      2,
      tag,
      "signed headers are browser-supplyable",
      signedHeaders === "content-length;host",
      `X-Amz-SignedHeaders=${signedHeaders ?? "(absent)"}`
    );

    const objectUrl = objectUrlOf(upload.url);

    // 3. Preflight from the real web origin.
    const allowed = await preflight(objectUrl, ALLOWED_ORIGIN, "PUT");
    record(
      3,
      tag,
      `CORS preflight from ${ALLOWED_ORIGIN}`,
      allowed.status === 204 && allowed.allowOrigin === ALLOWED_ORIGIN,
      `${allowed.status} allow-origin=${allowed.allowOrigin ?? "(none)"} methods=${allowed.allowMethods ?? "(none)"}`
    );

    // 4. The PUT itself, with exactly the headers the module says to send.
    const putRes = await fetch(upload.url, { method: "PUT", headers: upload.requiredHeaders, body: bytes });
    const putOk = putRes.status === 200;
    record(
      4,
      tag,
      "presigned PUT returns 200",
      putOk,
      putOk ? "200" : `${putRes.status} ${errorCodeOf(await putRes.text())}`
    );

    const download = await createDownloadUrl({ key: upload.key, filename, env });
    const getRes = await fetch(download.url);
    const body = getRes.ok ? Buffer.from(await getRes.arrayBuffer()) : Buffer.alloc(0);

    // 5. Byte-exact round trip. sha256 rather than a length check so a
    //    truncated or re-encoded object cannot pass.
    const expectedHash = sha256(bytes);
    const actualHash = getRes.ok ? sha256(body) : "(no body)";
    record(
      5,
      tag,
      "presigned GET round-trips with matching sha256",
      getRes.status === 200 && actualHash === expectedHash,
      getRes.status === 200
        ? `${body.length} bytes, sha256 ${actualHash.slice(0, 16)}… ${actualHash === expectedHash ? "==" : "!="} expected`
        : `GET ${getRes.status}`
    );

    // 6. The response overrides `createDownloadUrl` forces from the key's own
    //    extension — never from whatever Content-Type ended up stored on the
    //    object (see that function's comment).
    const contentType = getRes.headers.get("content-type");
    const disposition = getRes.headers.get("content-disposition");
    record(
      6,
      tag,
      "download is inline with the correct content-type",
      contentType === mimeType && !!disposition?.startsWith("inline;"),
      `content-type=${contentType ?? "(none)"} content-disposition=${disposition ?? "(none)"}`
    );

    // 9. Negative control: the object key is inside the signature, so a URL
    //    signed for this creator cannot be replayed against another creator's
    //    key. A 403 SignatureDoesNotMatch is the PASS. A 404 NoSuchKey would
    //    be a FAIL — it would mean R2 authenticated the request first and only
    //    then failed to find the object, i.e. the key is not actually signed.
    const otherCreatorId = randomUUID();
    const tamperedUrl = download.url.replace(
      `/creators/${ids.creatorId}/`,
      `/creators/${otherCreatorId}/`
    );
    const tamperedRes = await fetch(tamperedUrl);
    const tamperedCode = errorCodeOf(await tamperedRes.text());
    record(
      9,
      tag,
      "presigned GET signature is bound to the key",
      tamperedRes.status === 403 && tamperedCode === "SignatureDoesNotMatch",
      `replay against another creator's key -> ${tamperedRes.status} ${tamperedCode}`
    );

    // 7. Delete really removes the object. Asserted through a presigned GET
    //    rather than a HeadObject so the check goes through the same read path
    //    a creator would.
    //
    //    The key stays on the cleanup list until the 404 is *observed*. The
    //    one failure mode this check exists to catch — `deleteObject` returns
    //    happily but the object is still there — is precisely the one where
    //    cleanup must still retry.
    await deleteObject(upload.key, env);
    const gone = await stillStored(upload.key, filename, env);
    if (!gone.present) forget(createdKeys, upload.key);
    record(7, tag, "deleteObject really removes the object", !gone.present, `GET after delete -> ${gone.detail}`);

    // 8. Negative control: the bucket's CORS policy is an allowlist, not a
    //    wildcard echo. A 403 with no allow headers is the PASS; a 204 that
    //    echoes the origin back would mean any site could drive uploads and
    //    reads with a leaked presigned URL.
    const denied = await preflight(objectUrl, DISALLOWED_ORIGIN, "PUT");
    record(
      8,
      tag,
      `CORS preflight from ${DISALLOWED_ORIGIN} is refused`,
      denied.status === 403 && denied.allowOrigin === null && denied.allowMethods === null,
      `${denied.status} allow-origin=${denied.allowOrigin ?? "(none)"} methods=${denied.allowMethods ?? "(none)"}`
    );

    // 10. The 25 MB size cap is only real if the *bucket* enforces the signed
    //     `Content-Length`. `assertWithinSizeCap` runs before signing, so it
    //     stops nothing on its own: a client that presigns for 1 KB and then
    //     PUTs 40 MB is refused by the wire or not at all. `presign.ts`'s doc
    //     comment asserts that enforcement as fact, and `storage.e2e.test.ts`
    //     proves it — against MinIO. Different server, different codebase; the
    //     property was never checked on the bucket that actually holds creator
    //     evidence. This is that check.
    //
    //     `fetch` computes Content-Length from the body it is given, so sending
    //     extra bytes lands on the wire as a declared length that disagrees
    //     with the one inside the signature. PASS is: rejected, AND nothing
    //     stored. A rejection alone would not be enough — a partial write that
    //     is refused but still persists the bytes fails this for real reasons.
    const capUpload = await createUploadUrl({
      creatorId: ids.creatorId,
      dealId: ids.dealId,
      scope,
      mimeType,
      sizeBytes: bytes.length,
      filename,
      env,
    });
    createdKeys.push(capUpload.key);
    const oversized = Buffer.concat([
      Buffer.from(bytes),
      Buffer.from("extra trailing bytes not covered by the signed Content-Length"),
    ]);
    const oversizeRes = await fetch(capUpload.url, {
      method: "PUT",
      headers: { "Content-Type": mimeType },
      body: oversized,
    });
    const oversizeCode = oversizeRes.ok ? "(accepted)" : errorCodeOf(await oversizeRes.text());
    const stored = await stillStored(capUpload.key, filename, env);
    if (!stored.present) forget(createdKeys, capUpload.key);
    record(
      10,
      tag,
      "oversize body is refused at the wire and nothing is stored",
      !oversizeRes.ok && !stored.present,
      `PUT ${oversizeRes.status} ${oversizeCode}; GET after -> ${stored.detail}`
    );
  } finally {
    // Best-effort: check 7 clears this list on the happy path, so this only
    // fires when a check above threw or failed before the delete.
    for (const key of createdKeys) {
      try {
        await deleteObject(key, env);
        console.log(`  ..    cleanup: deleted ${key}`);
      } catch (err) {
        console.error(`  ..    cleanup FAILED for ${key}: ${(err as Error).message}`);
      }
    }
  }
}

async function main(): Promise<void> {
  const env = loadEnv();
  const config = getStorageConfig(env) as StorageConfig;

  const creatorId = randomUUID();
  const dealId = randomUUID();
  const runPrefix = `creators/${creatorId}/`;

  console.log("Live storage verification");
  console.log(`  endpoint : ${config.endpoint}`);
  console.log(`  bucket   : ${config.bucket} (region ${config.region})`);
  console.log(`  prefix   : ${runPrefix}  <- the only prefix this run reads or writes`);
  console.log("");

  for (const fixture of FIXTURES) {
    console.log(`scope: ${fixture.scope} (${fixture.mimeType})`);
    try {
      await verifyScope(fixture, { creatorId, dealId }, env);
    } catch (err) {
      record(0, fixture.scope, "scope run completed", false, `threw: ${(err as Error).message}`);
    }
    console.log("");
  }

  // 11. Nothing left behind. Scoped to this run's own prefix so a concurrent
  //     run, a real creator upload, or the SPO-355 canary under `_ops/` can
  //     never make this fail — and so a green here means *this* run cleaned up,
  //     not that the bucket happens to be empty.
  console.log("cleanup");
  try {
    const listed = await buildS3Client(config).send(
      new ListObjectsV2Command({ Bucket: config.bucket, Prefix: runPrefix })
    );
    const keyCount = listed.KeyCount ?? 0;
    record(
      11,
      "run",
      "run prefix is empty afterwards",
      keyCount === 0,
      `KeyCount=${keyCount}${keyCount ? ` (${(listed.Contents ?? []).map((o) => o.Key).join(", ")})` : ""}`
    );
  } catch (err) {
    record(11, "run", "run prefix is empty afterwards", false, `list threw: ${(err as Error).message}`);
  }

  const passed = results.filter((r) => r.ok).length;
  console.log("");
  console.log(`${passed}/${results.length} checks passed against ${config.bucket}`);

  if (passed !== results.length) {
    console.log("");
    console.log("FAILED:");
    for (const r of results.filter((x) => !x.ok)) {
      console.log(`  ${r.n}. [${r.scope}] ${r.name} — ${r.detail}`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
