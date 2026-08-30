import { randomUUID } from "node:crypto";
import {
  contractFileMimeTypes,
  maxFileUploadBytes,
  planStorageQuotaBytes,
  proofFileMimeTypes,
} from "@sponsee/shared";
import type { PlanTier } from "@sponsee/shared";
import type { SubscriptionStatus } from "@sponsee/db/schema";
import { isPaidSubscription } from "../billing/entitlements.js";

export type UploadPurpose = "proof" | "contract";

/** Extension for a known allowlisted mime type ("" when unknown). */
export function extensionFor(mimeType: string): string {
  const map: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "application/pdf": ".pdf",
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
    "video/webm": ".webm",
  };
  return map[mimeType] ?? "";
}

export function allowedMimeTypes(purpose: UploadPurpose): readonly string[] {
  return purpose === "contract" ? contractFileMimeTypes : proofFileMimeTypes;
}

export function isAllowedMimeType(purpose: UploadPurpose, mimeType: string): boolean {
  return (allowedMimeTypes(purpose) as readonly string[]).includes(mimeType);
}

export function assertSizeWithinCap(sizeBytes: number): void {
  if (sizeBytes <= 0 || sizeBytes > maxFileUploadBytes) {
    throw new Error(
      `File size must be between 1 byte and ${Math.round(maxFileUploadBytes / 1024 / 1024)} MB`,
    );
  }
}

/**
 * Object key is scoped to the creator so presigned-GET authorization can be a
 * simple prefix check and cross-tenant reads are impossible.
 */
export function buildStorageKey(params: {
  creatorId: string;
  purpose: UploadPurpose;
  dealId: string;
  mimeType: string;
}): string {
  const dir = params.purpose === "contract" ? "contracts" : "proofs";
  return `${params.creatorId}/${dir}/${params.dealId}/${randomUUID()}${extensionFor(params.mimeType)}`;
}

/** A key is only servable by the tenant whose id prefixes it. */
export function isOwnedKey(key: string, creatorId: string): boolean {
  return key.startsWith(`${creatorId}/`);
}

/** Per-plan storage quota; unpaid accounts stay on starter limits. */
export function getStorageQuotaBytes(
  plan: PlanTier,
  subscriptionStatus: SubscriptionStatus | null,
): number {
  if (!isPaidSubscription(subscriptionStatus)) {
    return planStorageQuotaBytes.starter;
  }
  return planStorageQuotaBytes[plan];
}
