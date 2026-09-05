import { describe, it, expect } from "vitest";
import { buildInvoiceText } from "./invoice.js";
import { invoices } from "@sponsee/db/schema";

// Pure unit tests for the plain-text renderer. No PGlite / provider here: the
// contact line and paid marker are string logic, and the send path can never
// exercise the paid branch (a paid invoice refuses to send), so it is covered
// directly rather than through the router.

const baseInvoice = {
  id: "inv-1",
  creatorId: "creator-1",
  dealId: null,
  number: 12,
  contactId: null,
  title: "Spring hardware launch",
  milestoneNote: null,
  amountCents: 450000,
  currency: "USD",
  terms: "net_30",
  issuedAt: new Date("2026-09-02T00:00:00Z"),
  dueAt: new Date("2026-10-02T00:00:00Z"),
  status: "open",
  paidAt: null,
  paidNote: null,
  railsSnapshot: null,
  createdAt: new Date("2026-09-02T00:00:00Z"),
  updatedAt: new Date("2026-09-02T00:00:00Z"),
} as typeof invoices.$inferSelect;

const rails = {
  displayName: "Nightshade Media",
  paypalLink: "https://paypal.me/nightshademedia",
  wiseText: "Wise: nightshade@example.com",
  bankText: "Bank account",
  replyToEmail: "kaya@nightshademedia.example",
};

describe("buildInvoiceText — creator contact line (SPO-428)", () => {
  it("renders the creator email in the FROM block when one resolves", () => {
    const text = buildInvoiceText({
      invoice: baseInvoice,
      invoiceLabel: "INV-0012",
      rails,
      creatorEmail: "kaya@nightshademedia.example",
    });
    expect(text).toContain("FROM\n  Nightshade Media\n  kaya@nightshademedia.example");
  });

  it("drops the contact line entirely when no email resolves — never an empty or whitespace-only line", () => {
    const text = buildInvoiceText({
      invoice: baseInvoice,
      invoiceLabel: "INV-0012",
      rails,
      creatorEmail: null,
    });

    // The email is absent...
    expect(text).not.toContain("kaya@nightshademedia.example");
    // ...and the FROM block terminates at the display name, so there is no
    // blank line where the address would have been. The assertion is on the
    // element (line) being absent, not merely empty.
    expect(text.endsWith("FROM\n  Nightshade Media")).toBe(true);
  });
});

describe("buildInvoiceText — paid marker (SPO-428)", () => {
  it("marks the title block 'INVOICE … — PAID' on a paid invoice", () => {
    const text = buildInvoiceText({
      invoice: {
        ...baseInvoice,
        status: "paid",
        paidAt: new Date("2026-09-18T00:00:00Z"),
      },
      invoiceLabel: "INV-0012",
      rails,
      creatorEmail: "kaya@nightshademedia.example",
    });
    expect(text).toContain("INVOICE INV-0012 — PAID");
    expect(text).toContain("Amount paid:");
  });

  it("leaves the title block unmarked on an unpaid invoice", () => {
    const text = buildInvoiceText({
      invoice: baseInvoice,
      invoiceLabel: "INV-0012",
      rails,
      creatorEmail: "kaya@nightshademedia.example",
    });
    expect(text).toContain("INVOICE INV-0012");
    expect(text).not.toContain(" — PAID");
  });
});
