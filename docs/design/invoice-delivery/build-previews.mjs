#!/usr/bin/env node
// Renders the SPO-366 invoice templates against fixture variants so the
// design can be reviewed (and screenshotted) without the app running.
//   node build-previews.mjs <outDir>
// Emits <outDir>/{variant}.email.html, {variant}.email.txt, {variant}.page.html

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2] ?? join(here, "preview-out");
mkdirSync(outDir, { recursive: true });

// --- tiny template engine: {{var}} + nestable {{#if var}}...{{/if}} ---
function render(template, vars, { escapeHtml }) {
  const tokens = template.split(/({{#if \w+}}|{{\/if}})/);
  const stack = [{ children: [] }];
  for (const tok of tokens) {
    const open = tok.match(/^{{#if (\w+)}}$/);
    if (open) {
      const node = { cond: open[1], children: [] };
      stack[stack.length - 1].children.push(node);
      stack.push(node);
    } else if (tok === "{{/if}}") {
      if (stack.length < 2) throw new Error("unbalanced {{/if}}");
      stack.pop();
    } else {
      stack[stack.length - 1].children.push(tok);
    }
  }
  if (stack.length !== 1) throw new Error("unclosed {{#if}}");

  const esc = (s) =>
    escapeHtml
      ? String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
      : String(s);
  const fill = (text) =>
    text.replace(/{{(\w+)}}/g, (_, k) => {
      if (!(k in vars)) throw new Error(`missing template var: ${k}`);
      return esc(vars[k] ?? "");
    });
  const walk = (node) =>
    node.children
      .map((c) => (typeof c === "string" ? fill(c) : vars[c.cond] ? walk(c) : ""))
      .join("");
  return walk(stack[0]);
}

// --- derived fields, mirroring what the API should compute at send time ---
function derive(f) {
  const money = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: f.currency,
  }).format(f.amountCents / 100);
  const date = (iso) =>
    new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(new Date(iso));
  const indent = (s) => (s ? String(s).split("\n").join("\n  ") : s);
  const termsLabel = { net_15: "Net 15", net_30: "Net 30", net_45: "Net 45" }[f.terms];
  return {
    ...f,
    invoiceNumberFormatted: `INV-${String(f.number).padStart(4, "0")}`,
    dealTitle: f.dealTitle || "Sponsorship services",
    amountFormatted: money,
    termsLabel,
    issuedDate: date(f.issuedAt),
    dueDateLine: f.dueAt ? `Due ${date(f.dueAt)}` : "Due on receipt",
    dueDateValue: f.dueAt ? date(f.dueAt) : "On receipt",
    greetingLine: f.contactName ? `Hi ${f.contactName.split(" ")[0]},` : "Hello,",
    paidDate: f.paidAt ? date(f.paidAt) : "",
    isPaid: !!f.paidAt,
    isUnpaid: !f.paidAt,
    noRails: !f.paypalLink && !f.wiseText && !f.bankText,
    milestoneNoteIndented: indent(f.milestoneNote),
    wiseTextIndented: indent(f.wiseText),
    bankTextIndented: indent(f.bankText),
  };
}

const base = {
  number: 12,
  creatorDisplayName: "Nightshade Media",
  brandName: "Meridian Peripherals",
  contactName: "Dana Whitfield",
  dealTitle: "Spring hardware launch — dedicated stream + 3 sponsored segments",
  milestoneNote: "Second sponsored segment aired August 28 (VOD timestamped at 1:42:10).",
  amountCents: 450000,
  currency: "USD",
  terms: "net_30",
  issuedAt: "2026-09-02T00:00:00Z",
  dueAt: "2026-10-02T00:00:00Z",
  paidAt: null,
  paypalLink: "https://paypal.me/nightshademedia",
  wiseText: "Wise account: nightshade@example.com\nAccount holder: Kaya Reyes",
  bankText: "First Meridian Bank\nRouting 021000021 · Account 4820013377\nAccount name: Nightshade Media LLC",
  hostedInvoiceUrl: "https://sponsee.vercel.app/i/3f9c2a71d4e8b6a09c5f1e7d2b8a4c60",
};

const variants = {
  baseline: {},
  "one-rail": { wiseText: null, bankText: null },
  "no-rails": { paypalLink: null, wiseText: null, bankText: null },
  stress: {
    dealTitle:
      "Q4 multi-platform sponsorship — dedicated launch stream, three mid-roll sponsored segments across the fall league co-stream schedule, evergreen VOD rights (12 months), plus one dedicated short-form recap per segment on TikTok and YouTube Shorts",
    milestoneNote:
      "Deliverables 1–3 of 4 complete: launch stream aired September 12 (peak 3,180 CCV, VOD timestamped), mid-roll segments aired September 19 and 26.\nRemaining segment scheduled October 3; invoiced separately per the agreed 75/25 split.",
    brandName: "Meridian Peripherals International Holdings B.V.",
  },
  paid: { paidAt: "2026-09-18T00:00:00Z" },
  minimal: {
    dealTitle: null,
    milestoneNote: null,
    contactName: null,
    dueAt: null,
    paypalLink: null,
    bankText: null,
  },
};

const emailHtml = readFileSync(join(here, "invoice-email.html"), "utf8");
const emailText = readFileSync(join(here, "invoice-email.txt"), "utf8");
const pageHtml = readFileSync(join(here, "invoice-page.html"), "utf8");

for (const [name, overrides] of Object.entries(variants)) {
  const vars = derive({ ...base, ...overrides });
  writeFileSync(join(outDir, `${name}.email.html`), render(emailHtml, vars, { escapeHtml: true }));
  writeFileSync(join(outDir, `${name}.email.txt`), render(emailText, vars, { escapeHtml: false }));
  // Previews are served from a flat dir; point font URLs at ./fonts/.
  const page = render(pageHtml, vars, { escapeHtml: true }).replaceAll('url("/fonts/', 'url("./fonts/');
  writeFileSync(join(outDir, `${name}.page.html`), page);
}
console.log(`wrote ${Object.keys(variants).length} variants × 3 formats to ${outDir}`);
