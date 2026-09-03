# Invoice delivery — email + hosted page design (SPO-366)

Design reference for the two things a brand sees: the invoice email and the
hosted invoice page (`/i/:token`). Context: `plan` document on SPO-358.
Engineering swaps these in for the plain functional template; the templates in
this directory are the source of truth for markup, styling, and copy.

## Files

| file | what it is |
|---|---|
| `invoice-email.txt` | Plain-text MIME part. **The invoice of record** — complete on its own for AP inboxes that strip HTML. |
| `invoice-email.html` | HTML MIME part. Email-safe: tables, inline styles, **zero images, zero webfonts**. |
| `invoice-page.html` | Hosted page. The `@media print` layout is the deliverable — AP prints this to PDF and files it. |
| `build-previews.mjs` | Renders all fixture variants (`node build-previews.mjs <outDir>`) for review/screenshots. |
| `screenshots/` | Verified renders: every variant, screen + print, incl. single-page PDF proof. |

## Template grammar

`{{var}}` substitutions plus nestable `{{#if var}}…{{/if}}` (truthy check).
Map onto any templating engine; `build-previews.mjs` `render()` is the
reference implementation. **HTML-escape every value in the HTML templates;
never escape in the text template.**

## Variables (derive at send time, snapshot into `invoice_deliveries`)

| var | source / rule |
|---|---|
| `invoiceNumberFormatted` | `INV-` + `invoices.number` zero-padded to 4 (`INV-0012`). Per-creator sequence. |
| `creatorDisplayName` | `rails_snapshot.displayName` (frozen at send). |
| `brandName`, `contactName` | contact's brand + contact name. `contactName` optional → Attn line drops. |
| `greetingLine` | `Hi {first token of contactName},` else `Hello,` |
| `dealTitle` | `invoices.title`; **fallback `"Sponsorship services"`** when null — an invoice needs a description line for AP filing. |
| `milestoneNote` | optional; multiline allowed (`pre-wrap` in HTML, 2-space continuation indent in text — see `milestoneNoteIndented`). |
| `amountFormatted` | `Intl.NumberFormat("en-US", {style:"currency", currency})` of `amountCents/100`. Always render ` {{currency}}` code after it — symbol alone is ambiguous ($ = USD/CAD/AUD). |
| `termsLabel` | `net_15/30/45` → `Net 15/30/45`. |
| `issuedDate` | long form, e.g. `September 2, 2026`. |
| `dueDateLine` / `dueDateValue` | sentence form `Due October 2, 2026` / value form `October 2, 2026`. Null `dueAt` → `Due on receipt` / `On receipt`. Don't mix them up — `dueDateValue` goes after a "Due" label. |
| `isPaid` / `isUnpaid` / `paidDate` | from `status`/`paidAt`. |
| `paypalLink`, `wiseText`, `bankText` | from `rails_snapshot` (frozen at send, never live creator fields). `wiseText`/`bankText` are free multiline text. |
| `noRails` | all three rails empty. |
| `hostedInvoiceUrl` | front door + `/i/{public_token}`. Front door is currently `sponsee.vercel.app` (SPO-104) — take it from config, don't hardcode. |

## Design decisions (the "why")

- **Plain text carries the whole invoice.** Number, parties, deal, milestone,
  amount+currency, terms, issued, due, rails, hosted link. The hosted link is
  an *addition*; the text part alone must be filable. Verified as literal text
  for all six fixture variants.
- **No images, no webfonts in the email.** Nothing to strip, nothing to block,
  no "load remote content" nag. Serif accents (creator name, amount) use
  Georgia — the email stand-in for Instrument Serif. Warm-paper palette:
  `#F7F5F1` bg, `#1B1815` ink, `#8A8178` muted, `#E8E3DB` border, `#0E7A5F`
  pine for links/CTA only.
- **Amount is the hero in the email** (top card, 32px serif) because a brand's
  AP reader triages by amount+due date. On the hosted page the amount sits
  lower (classic invoice order: parties → line → total) because that page is
  a filing document, not a triage surface.
- **Hosted page = paper.** No nav, no auth chrome, no marketing. Screen shows
  a sheet on warm paper with one screen-only footer bar (reply hint +
  Print/save PDF button). `@media print` strips background, border, footer,
  compacts type, and `break-inside: avoid`s each section. **Every variant
  prints to exactly one Letter page** (verified, incl. the long-title/long-note
  stress case).
- **Paid state:** pine-outline PAID chip in the header, `Paid` date row,
  label flips to "Amount paid", rails are replaced by a "This invoice has been
  paid" note. AP files paid invoices; pay instructions on a settled invoice
  invite double payment.
- **No overdue state on the artifact.** Chasing lives in chase emails; the
  invoice itself never scolds.
- **Zero rails** → "To arrange payment, reply to the invoice email and
  {creator} will send payment details." Businesslike, and consistent with
  reply-to → creator (the SPO-358 house pattern).
- **Rail order fixed: PayPal, Wise, Bank** — fastest-to-act first.
- **Tone:** third person, no exclamation points, no "thanks so much!". The
  creator is an agency. One "Sent with Sponsee" line (11px, muted) in the
  email footer only; nothing of ours in print.

## Copy blocks (canonical)

- Subject: `Invoice {{invoiceNumberFormatted}} from {{creatorDisplayName}} — {{amountFormatted}} {{currency}}, {{dueDateLine}}`
  (e.g. `Invoice INV-0012 from Nightshade Media — $4,500.00 USD, due October 2, 2026`)
- Preheader (HTML only): `Invoice {{n}} — {{amount}} {{currency}}, {{dueDateLine}}. Payment details inside.`
- Reply hint (both parts + page footer): `Questions about this invoice? Reply to this email — it goes directly to {{creatorDisplayName}}.`

## Engineering notes

- Text part: indent continuation lines of multiline values by two spaces
  (`value.split("\n").join("\n  ")` — the `*Indented` vars).
- Hosted page fonts are the apps/web self-hosted files (`/fonts/…woff2`, see
  `index.css`); previews rewrite to `./fonts/` because they're served flat.
- `noindex, nofollow` meta on the hosted page — tokened URLs must not end up
  in an index.
- Accessibility: single `<h1>`, labeled sections, focus-visible ring on the
  print button, link color pine on white ≥ 4.5:1.
- QA fixture note: the email `View & print invoice` button URL and the plain
  URL under it must both be the hosted link — the QA chain (SPO-358 §6 step 3)
  extracts `/i/:token` from the captured body.
