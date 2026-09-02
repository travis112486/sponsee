// Wire-level proof that the storage module works against a REAL S3-compatible
// server (MinIO in CI — see .github/workflows/ci.yml's `storage-e2e` job).
//
// Every other test in this directory (storage.test.ts, sweep.test.ts) is pure
// local logic or mocks the S3 client outright — SigV4 presigning is offline
// crypto, so those suites never actually contact a server. This file is the
// only place that: PUTs real bytes through a presigned URL, GETs them back,
// and asserts a real bucket's contents change. See SPO-171.
//
// `forcePathStyle: true` (client.ts) is the only thing this needs from MinIO
// specifically; everything exercised here is plain S3 API, so this suite
// doubles as the wire-level proof for whatever vendor SPO-155 eventually
// picks (R2, S3, B2) without needing that decision made first.
//
// Deliberately NOT wired into the default `pnpm test` — see the `exclude` in
// scripts/vitest-api.config.ts and apps/api/vitest.config.ts. Run it with
// `pnpm test:storage-e2e` against a running MinIO (see loadEnv() below for the
// one-line docker command), same as CI does.
import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CreateBucketCommand, HeadObjectCommand, NotFound, PutObjectCommand } from "@aws-sdk/client-s3";
import { db } from "@sponsee/db";
import * as schema from "@sponsee/db/schema";
import { eq, sql } from "drizzle-orm";
import { initPgliteSchema } from "../test-utils/pglite-setup.js";
import { SCHEMA_SQL } from "../test-utils/schema-sql.js";
import { buildS3Client } from "./client.js";
import { getStorageConfig, type StorageConfig } from "./config.js";
import { deleteObject } from "./delete.js";
import { keyBelongsToDeal } from "./keys.js";
import { createDownloadUrl, createUploadUrl } from "./presign.js";
import { runStorageOrphanSweep } from "./sweep.js";

const REQUIRED_VARS = [
  "STORAGE_ENDPOINT",
  "STORAGE_BUCKET",
  "STORAGE_REGION",
  "STORAGE_ACCESS_KEY_ID",
  "STORAGE_SECRET_ACCESS_KEY",
] as const;

/**
 * No silent skip — mirrors the Mailpit suites (see chase-integration.test.ts):
 * a suite whose whole purpose is "did we actually hit the wire" must fail
 * loudly when the wire isn't there, not report a false green.
 */
function loadEnv(): Record<string, string> {
  const missing = REQUIRED_VARS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `storage.e2e.test.ts needs a real S3-compatible server. Missing env: ${missing.join(", ")}.\n` +
        "Start MinIO and set the five STORAGE_* vars, e.g.:\n" +
        "  docker run -d -p 9000:9000 -e MINIO_ROOT_USER=minioadmin -e MINIO_ROOT_PASSWORD=minioadmin minio/minio server /data\n" +
        "  STORAGE_ENDPOINT=http://localhost:9000 STORAGE_BUCKET=sponsee-storage-e2e STORAGE_REGION=us-east-1 \\\n" +
        "  STORAGE_ACCESS_KEY_ID=minioadmin STORAGE_SECRET_ACCESS_KEY=minioadmin pnpm test:storage-e2e"
    );
  }
  return Object.fromEntries(REQUIRED_VARS.map((key) => [key, process.env[key] as string]));
}

const ENV = loadEnv();
const CONFIG = getStorageConfig(ENV) as StorageConfig;
const client = buildS3Client(CONFIG);

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

async function headExists(key: string): Promise<boolean> {
  try {
    await client.send(new HeadObjectCommand({ Bucket: CONFIG.bucket, Key: key }));
    return true;
  } catch (err) {
    if (err instanceof NotFound || (err as { name?: string }).name === "NotFound") return false;
    throw err;
  }
}

beforeAll(async () => {
  try {
    await client.send(new CreateBucketCommand({ Bucket: CONFIG.bucket }));
  } catch (err) {
    const code = (err as { Code?: string; name?: string }).Code ?? (err as { name?: string }).name;
    if (code !== "BucketAlreadyOwnedByYou" && code !== "BucketAlreadyExists") throw err;
  }
});

describe("presigned PUT + GET round trip", () => {
  it("accepts a real PNG PUT and reads it back byte-identical, inline", async () => {
    const creatorId = randomUUID();
    const dealId = randomUUID();

    const upload = await createUploadUrl({
      creatorId,
      dealId,
      scope: "proofs",
      mimeType: "image/png",
      sizeBytes: PNG_BYTES.length,
      filename: "screenshot.png",
      env: ENV,
    });
    expect(upload.key).toMatch(
      new RegExp(`^creators/${creatorId}/deals/${dealId}/proofs/[0-9a-f-]{36}\\.png$`)
    );

    const putRes = await fetch(upload.url, { method: "PUT", headers: upload.requiredHeaders, body: PNG_BYTES });
    expect(putRes.ok).toBe(true);

    const download = await createDownloadUrl({ key: upload.key, env: ENV });
    const getRes = await fetch(download.url);
    expect(getRes.ok).toBe(true);
    expect(getRes.headers.get("content-type")).toBe("image/png");
    expect(getRes.headers.get("content-disposition")).toMatch(/^inline;/);

    const roundTripped = Buffer.from(await getRes.arrayBuffer());
    expect(roundTripped.equals(PNG_BYTES)).toBe(true);
  });

  it("accepts a real PDF PUT and reads it back byte-identical, inline", async () => {
    const creatorId = randomUUID();
    const dealId = randomUUID();

    const upload = await createUploadUrl({
      creatorId,
      dealId,
      scope: "contracts",
      mimeType: "application/pdf",
      sizeBytes: PDF_BYTES.length,
      filename: "contract.pdf",
      env: ENV,
    });
    expect(upload.key).toMatch(
      new RegExp(`^creators/${creatorId}/deals/${dealId}/contracts/[0-9a-f-]{36}\\.pdf$`)
    );

    const putRes = await fetch(upload.url, { method: "PUT", headers: upload.requiredHeaders, body: PDF_BYTES });
    expect(putRes.ok).toBe(true);

    const download = await createDownloadUrl({ key: upload.key, env: ENV });
    const getRes = await fetch(download.url);
    expect(getRes.ok).toBe(true);
    expect(getRes.headers.get("content-type")).toBe("application/pdf");
    expect(getRes.headers.get("content-disposition")).toMatch(/^inline;/);

    const roundTripped = Buffer.from(await getRes.arrayBuffer());
    expect(roundTripped.equals(PDF_BYTES)).toBe(true);
  });

  it("forces attachment + octet-stream for a key with an unrecognized extension", async () => {
    // createUploadUrl only ever signs one of the five allowlisted extensions,
    // so a `.bin` object can only exist via a manual upload (a migration
    // leftover, a hand-crafted object) — put one directly to prove
    // createDownloadUrl's override still round-trips correctly against a
    // real server for that case.
    const key = `creators/${randomUUID()}/deals/${randomUUID()}/proofs/${randomUUID()}.bin`;
    const bytes = Buffer.from("arbitrary opaque bytes");
    await client.send(
      new PutObjectCommand({ Bucket: CONFIG.bucket, Key: key, Body: bytes, ContentType: "application/octet-stream" })
    );

    const download = await createDownloadUrl({ key, env: ENV });
    const getRes = await fetch(download.url);
    expect(getRes.ok).toBe(true);
    expect(getRes.headers.get("content-type")).toBe("application/octet-stream");
    expect(getRes.headers.get("content-disposition")).toMatch(/^attachment;/);

    const roundTripped = Buffer.from(await getRes.arrayBuffer());
    expect(roundTripped.equals(bytes)).toBe(true);
  });
});

describe("wire-level negative cases", () => {
  it("rejects a disallowed MIME type before ever contacting the bucket", async () => {
    await expect(
      createUploadUrl({
        creatorId: randomUUID(),
        dealId: randomUUID(),
        scope: "proofs",
        mimeType: "text/html",
        sizeBytes: 1024,
        filename: "evil.html",
        env: ENV,
      })
    ).rejects.toThrow();
  });

  it("rejects image/svg+xml before ever contacting the bucket", async () => {
    await expect(
      createUploadUrl({
        creatorId: randomUUID(),
        dealId: randomUUID(),
        scope: "proofs",
        mimeType: "image/svg+xml",
        sizeBytes: 1024,
        filename: "evil.svg",
        env: ENV,
      })
    ).rejects.toThrow();
  });

  it("rejects a file over MAX_UPLOAD_BYTES before ever contacting the bucket", async () => {
    await expect(
      createUploadUrl({
        creatorId: randomUUID(),
        dealId: randomUUID(),
        scope: "proofs",
        mimeType: "image/png",
        sizeBytes: 25 * 1024 * 1024 + 1,
        filename: "huge.png",
        env: ENV,
      })
    ).rejects.toThrow();
  });

  // Measured against real MinIO, not assumed: inspecting the presigned URL's
  // `X-Amz-SignedHeaders` shows only `content-length;host` — Content-Type is
  // NOT part of what @aws-sdk/s3-request-presigner signs by default (it's
  // dropped before the signing step, not hoisted into the query string
  // either). So a client can swap the Content-Type header on the actual PUT
  // and MinIO accepts it; the signature alone does not pin the MIME type.
  // That's fine in practice, not a hole: `createDownloadUrl` never trusts
  // whatever Content-Type ended up stored on the object — it always forces
  // `ResponseContentType`/`ResponseContentDisposition` from the key's own
  // extension (see the "round trip" describe block above), which was chosen
  // server-side from the originally-validated mimeType before the PUT ever
  // happened. This test pins that real behavior down so it doesn't quietly
  // become assumed-but-unverified again.
  it("MinIO accepts a PUT whose Content-Type differs from what was requested — enforcement is not at the wire", async () => {
    const upload = await createUploadUrl({
      creatorId: randomUUID(),
      dealId: randomUUID(),
      scope: "proofs",
      mimeType: "image/png",
      sizeBytes: PNG_BYTES.length,
      filename: "screenshot.png",
      env: ENV,
    });

    const swappedRes = await fetch(upload.url, {
      method: "PUT",
      headers: { "Content-Type": "image/jpeg", "Content-Length": upload.requiredHeaders["Content-Length"] },
      body: PNG_BYTES,
    });
    expect(swappedRes.ok).toBe(true);

    // The download path still serves it as image/png — from the key's
    // extension, never from whatever Content-Type actually got stored.
    const download = await createDownloadUrl({ key: upload.key, env: ENV });
    const getRes = await fetch(download.url);
    expect(getRes.headers.get("content-type")).toBe("image/png");
  });

  it("MinIO itself rejects a PUT whose body is larger than the signed Content-Length", async () => {
    const upload = await createUploadUrl({
      creatorId: randomUUID(),
      dealId: randomUUID(),
      scope: "proofs",
      mimeType: "image/png",
      sizeBytes: PNG_BYTES.length,
      filename: "screenshot.png",
      env: ENV,
    });

    // Sends more bytes than were declared to the signer. fetch computes its
    // own Content-Length from the actual body, so this lands on the wire as a
    // declared length that disagrees with what the signature covers.
    const oversized = Buffer.concat([PNG_BYTES, Buffer.from("extra trailing bytes not part of the signed length")]);
    const tamperedRes = await fetch(upload.url, {
      method: "PUT",
      headers: { "Content-Type": "image/png" },
      body: oversized,
    });
    expect(tamperedRes.ok).toBe(false);
    expect(await headExists(upload.key)).toBe(false);
  });

  it("cross-creator and cross-deal key access is rejected against a real uploaded key", async () => {
    const creatorId = randomUUID();
    const dealId = randomUUID();
    const otherCreatorId = randomUUID();
    const otherDealId = randomUUID();

    const upload = await createUploadUrl({
      creatorId,
      dealId,
      scope: "proofs",
      mimeType: "image/png",
      sizeBytes: PNG_BYTES.length,
      filename: "screenshot.png",
      env: ENV,
    });
    const putRes = await fetch(upload.url, { method: "PUT", headers: upload.requiredHeaders, body: PNG_BYTES });
    expect(putRes.ok).toBe(true);

    // The object is real and reachable, so this isn't a "key never existed"
    // false negative — the ownership check is what has to gate it.
    expect(await headExists(upload.key)).toBe(true);
    expect(keyBelongsToDeal(upload.key, { creatorId, dealId })).toBe(true);
    expect(keyBelongsToDeal(upload.key, { creatorId: otherCreatorId, dealId })).toBe(false);
    expect(keyBelongsToDeal(upload.key, { creatorId, dealId: otherDealId })).toBe(false);
  });
});

describe("delete", () => {
  it("actually removes the object from the bucket, not just a Postgres row", async () => {
    const creatorId = randomUUID();
    const dealId = randomUUID();
    const upload = await createUploadUrl({
      creatorId,
      dealId,
      scope: "proofs",
      mimeType: "image/png",
      sizeBytes: PNG_BYTES.length,
      filename: "screenshot.png",
      env: ENV,
    });
    await fetch(upload.url, { method: "PUT", headers: upload.requiredHeaders, body: PNG_BYTES });
    expect(await headExists(upload.key)).toBe(true);

    await deleteObject(upload.key, ENV);

    expect(await headExists(upload.key)).toBe(false);
  });
});

describe("SPO-348: deal deletion must not destroy registered files", () => {
  beforeAll(async () => {
    await initPgliteSchema(SCHEMA_SQL);
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE deals, brands, creators, creator_files CASCADE`);
  });

  it("survives a real deal-row deletion: objects stay in the bucket, creator_files rows stay with originDealId null and the title preserved", async () => {
    const [creator] = await db.insert(schema.creators).values({ displayName: "E2E Creator" }).returning();
    const [brand] = await db.insert(schema.brands).values({ creatorId: creator.id, name: "E2E Brand" }).returning();
    const [deal] = await db
      .insert(schema.deals)
      .values({ creatorId: creator.id, brandId: brand.id, title: "Acme Q3 sponsorship" })
      .returning();

    const evidenceKey = `creators/${creator.id}/deals/${deal.id}/proofs/${randomUUID()}.png`;
    const contractKey = `creators/${creator.id}/deals/${deal.id}/contracts/${randomUUID()}.pdf`;
    await client.send(
      new PutObjectCommand({ Bucket: CONFIG.bucket, Key: evidenceKey, Body: PNG_BYTES, ContentType: "image/png" })
    );
    await client.send(
      new PutObjectCommand({
        Bucket: CONFIG.bucket,
        Key: contractKey,
        Body: PDF_BYTES,
        ContentType: "application/pdf",
      })
    );

    // Mirrors what proof.create/contract.upsert do in the same transaction as
    // their row insert (see routers/proof.ts, routers/contract.ts): the
    // proof/contract row and the creator_files row that registers the
    // object's lifecycle both exist before the deal is ever touched.
    await db.insert(schema.proofs).values({
      dealId: deal.id,
      kind: "file",
      storageKey: evidenceKey,
      mimeType: "image/png",
      sizeBytes: PNG_BYTES.length,
    });
    await db.insert(schema.contracts).values({
      dealId: deal.id,
      storageKey: contractKey,
      mimeType: "application/pdf",
      sizeBytes: PDF_BYTES.length,
    });
    await db.insert(schema.creatorFiles).values([
      {
        creatorId: creator.id,
        storageKey: evidenceKey,
        mimeType: "image/png",
        sizeBytes: PNG_BYTES.length,
        originDealId: deal.id,
        originDealTitle: deal.title,
        scope: "evidence",
      },
      {
        creatorId: creator.id,
        storageKey: contractKey,
        mimeType: "application/pdf",
        sizeBytes: PDF_BYTES.length,
        originDealId: deal.id,
        originDealTitle: deal.title,
        scope: "contract",
      },
    ]);

    // The real deletion path: a hard delete of the deals row, which cascades
    // proofs/contracts (unchanged, expected) but only sets creator_files'
    // origin_deal_id null (schema/index.ts) — this is the assumption
    // SPO-348 corrects. Against pre-fix `main`, creator_files doesn't exist
    // and proofs/contracts.deal_id cascading would take the object's only DB
    // reference down with it, so the sweep below would have wrongly reclaimed
    // both objects.
    await db.delete(schema.deals).where(eq(schema.deals.id, deal.id));

    expect(await headExists(evidenceKey)).toBe(true);
    expect(await headExists(contractKey)).toBe(true);

    const survivors = await db
      .select()
      .from(schema.creatorFiles)
      .where(eq(schema.creatorFiles.creatorId, creator.id));
    expect(survivors).toHaveLength(2);
    for (const row of survivors) {
      expect(row.originDealId).toBeNull();
      expect(row.originDealTitle).toBe("Acme Q3 sponsorship");
      expect(row.deletedAt).toBeNull();
    }

    // The regression this issue exists to catch: with the grace period
    // forced to zero, a sweep run immediately after the deal delete must not
    // touch either object — both are still referenced by a live
    // creator_files row. (Not asserting `result.deleted === 0`: this suite
    // shares one bucket across every test in the file — see the module
    // comment — so earlier tests' own never-cleaned-up objects are
    // legitimately swept here too; that's unrelated noise, not a regression.)
    const result = await runStorageOrphanSweep(ENV, { graceMs: 0 });
    expect(result.skippedUnconfigured).toBe(false);

    expect(await headExists(evidenceKey)).toBe(true);
    expect(await headExists(contractKey)).toBe(true);
  });
});

describe("orphan sweep against real objects", () => {
  beforeAll(async () => {
    await initPgliteSchema(SCHEMA_SQL);
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE deals, brands, creators, creator_files CASCADE`);
  });

  it("reclaims a presigned upload that was never committed, but leaves a registered file alone", async () => {
    const [creator] = await db.insert(schema.creators).values({ displayName: "E2E Creator" }).returning();

    const registeredKey = `creators/${creator.id}/deals/${randomUUID()}/proofs/${randomUUID()}.png`;
    const abandonedKey = `creators/${creator.id}/deals/${randomUUID()}/proofs/${randomUUID()}.png`;

    for (const key of [registeredKey, abandonedKey]) {
      await client.send(
        new PutObjectCommand({ Bucket: CONFIG.bucket, Key: key, Body: PNG_BYTES, ContentType: "image/png" })
      );
    }

    // registeredKey has a creator_files row — as if proof.create's commit
    // mutation had run. abandonedKey does not — as if the client presigned
    // an upload, PUT the object, and never called the commit mutation.
    await db.insert(schema.creatorFiles).values({
      creatorId: creator.id,
      storageKey: registeredKey,
      mimeType: "image/png",
      sizeBytes: PNG_BYTES.length,
      scope: "evidence",
    });

    // graceMs: 0 — objects just created are already "past" a zero-length
    // grace period, so the sweep acts on them immediately instead of the
    // suite needing to wait out STORAGE_ORPHAN_GRACE_PERIOD_MS (24h) for real.
    const result = await runStorageOrphanSweep(ENV, { graceMs: 0 });
    expect(result.skippedUnconfigured).toBe(false);

    expect(await headExists(registeredKey)).toBe(true);
    expect(await headExists(abandonedKey)).toBe(false);
  });
});
