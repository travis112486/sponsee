import { describeActivity } from "./activity-label";

// The Topbar bell (SPO-153). Notifications are derived on the client from data
// the app already loads — the activity feed and the invoice list — rather than
// from a notifications table. Read state is per-device (localStorage), which is
// enough to stop the dot lying; move it server-side when we want it to follow a
// creator across devices.

export type AppNotification = {
  /** Stable across refetches so read state survives polling. */
  id: string;
  title: string;
  /** ISO timestamp of when the event became notification-worthy. */
  at: string;
  /** Omitted when we cannot resolve a destination we are sure about. */
  href?: string;
  tone: "default" | "alert";
};

export type ActivityEventLike = {
  id: string;
  actor: string;
  entityType: string;
  entityId: string;
  kind: string;
  payload: unknown;
  createdAt: string | Date;
};

export type InvoiceLike = {
  id: string;
  number: number;
  status: string;
  dueAt: string | Date | null;
  createdAt: string | Date;
};

const DEFAULT_LIMIT = 8;

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

// Only link where the destination is unambiguous. A wrong link is worse than
// no link, so contract/proof/platform events stay unlinked until those entities
// have routes of their own.
function activityHref(event: ActivityEventLike): string | undefined {
  if (event.entityType === "deal") return `/pipeline/${event.entityId}`;
  if (event.entityType === "invoice") return "/payments";
  return undefined;
}

export function buildNotifications({
  activity,
  invoices,
  now,
  limit = DEFAULT_LIMIT,
}: {
  activity?: ActivityEventLike[];
  invoices?: InvoiceLike[];
  now: Date;
  limit?: number;
}): AppNotification[] {
  const items: AppNotification[] = [];

  for (const event of activity ?? []) {
    items.push({
      id: `activity:${event.id}`,
      title: describeActivity(event.actor, event.payload, event.kind),
      at: toIso(event.createdAt),
      href: activityHref(event),
      tone: "default",
    });
  }

  for (const invoice of invoices ?? []) {
    if (invoice.status !== "open" || !invoice.dueAt) continue;
    const dueAt = new Date(invoice.dueAt);
    if (dueAt >= now) continue;
    // A backdated invoice only becomes notification-worthy when it is created,
    // not on its nominal due date — otherwise it would arrive pre-read.
    const createdAt = new Date(invoice.createdAt);
    const at = dueAt > createdAt ? dueAt : createdAt;
    items.push({
      id: `invoice-overdue:${invoice.id}`,
      title: `Invoice #${invoice.number} is overdue`,
      at: at.toISOString(),
      href: "/payments",
      tone: "alert",
    });
  }

  items.sort((a, b) => b.at.localeCompare(a.at));
  return items.slice(0, limit);
}

export function countUnread(notifications: AppNotification[], lastReadAt: string | null): number {
  if (!lastReadAt) return notifications.length;
  return notifications.filter((n) => n.at > lastReadAt).length;
}

/** The watermark to persist once the creator has seen the current list. */
export function readWatermark(notifications: AppNotification[], now: Date): string {
  const newest = notifications[0]?.at;
  const nowIso = now.toISOString();
  if (!newest) return nowIso;
  // Guard against an event timestamped in the future (clock skew) permanently
  // pinning the dot on.
  return newest > nowIso ? newest : nowIso;
}

export function lastReadStorageKey(userId: string | undefined): string {
  return `sponsee:notifications:lastReadAt:${userId ?? "anon"}`;
}

// localStorage throws in Safari private mode and when storage is disabled;
// a bell that cannot remember read state is still better than a crashed Topbar.
export function loadLastReadAt(userId: string | undefined): string | null {
  try {
    return window.localStorage.getItem(lastReadStorageKey(userId));
  } catch {
    return null;
  }
}

export function saveLastReadAt(userId: string | undefined, at: string): void {
  try {
    window.localStorage.setItem(lastReadStorageKey(userId), at);
  } catch {
    /* read state is best-effort */
  }
}
