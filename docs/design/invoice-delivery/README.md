# Invoice delivery — email + hosted page design (SPO-366)

Design reference for the two things a brand sees: the invoice email and the
hosted invoice page (`/i/:token`). Context: `plan` document on SPO-358.
Engineering swaps these in for the plain functional template; the templates in
this directory are the source of truth for markup, styling, and copy.

## Implementation status (SPO-428)

The contact line and the paid marker are now consumed by the shipping code —
the parts of this design that let AP reach the creator and file a settled
invoice. Everything else below is still the plain functional template and is
swapped in separately, not by SPO-428.

- `rails_snapshot` now carries `replyToEmail` (typed, frozen at send, and
  projected by `invoice.publicView`).
- `creatorEmail` resolves at render as `rails_snapshot.replyToEmail ??
  creator's current account email`. When neither resolves the contact line
  drops entirely — an absent element/line, never an empty one — in both the
  text part's FROM block and the hosted page's `.from-sub` line.
- The text part marks its title block `INVOICE … — PAID` on a paid invoice;
  the hosted page keeps its pine PAID chip. No HTML email is emitted yet, so
  "no header marker on the HTML part" is vacuous for now.

Still on the plain functional template (intentional divergence from
`invoice-email.txt` / `invoice-page.html`): the text part's billed-to block,
hosted-link line, hard-wrap and exact amount/date formatting, and the hosted
page's bill-to block and paid-date row. Those are a larger swap-in that also
expands `invoice.publicView`'s response shape, so they are deliberately out of
SPO-428's scope.

## Files

| file | what it is |
|---|---|
| `invoice-subject.txt` | The subject line, as a template. The copy block below is an example render, not the source. |
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
| `creatorEmail` | `rails_snapshot.replyToEmail` (frozen at send) — the same address the email's Reply-To carries. New snapshot field; engineering captures it at send alongside the rails. Gives the printed page and the text part a contact path — the paper artifact must let AP reach the creator without the original email. **Null/absent rule:** snapshots frozen before this field shipped lack it, and SPO-365 resends re-render from the stored snapshot. At render time resolve `rails_snapshot.replyToEmail ?? creator's current account email` — the same fallback that send's Reply-To header uses, so the printed contact line always matches where replies actually go. If neither resolves (defensive only), the contact line **drops entirely**: both templates wrap it in `{{#if creatorEmail}}`, so null *or* an absent key renders cleanly — never an empty line, an empty `.from-sub` div, or a template throw. The `no-email` fixture variant renders this path (with the key absent, the harsher case). |
| `brandName`, `contactName` | contact's brand + contact name. `contactName` optional → Attn line drops. |
| `greetingLine` | `Hi {first token of contactName},` else `Hello,` |
| `dealTitle` | `invoices.title`; **fallback `"Sponsorship services"`** when null — an invoice needs a description line for AP filing. Text part uses `dealTitleWrapped` (see wrapping rule in engineering notes). |
| `milestoneNote` | optional; multiline allowed (`pre-wrap` in HTML, 2-space continuation indent in text — see `milestoneNoteIndented`). |
| `amountFormatted` | `Intl.NumberFormat("en-US", {style:"currency", currency})` of `amountCents/100`. Always render ` {{currency}}` code after it — symbol alone is ambiguous ($ = USD/CAD/AUD). |
| `termsLabel` | `net_15/30/45` → `Net 15/30/45`. |
| `issuedDate` | long form, e.g. `September 2, 2026`. |
| `dueDateLine` / `dueDateValue` / `dueDatePhrase` | sentence form `Due October 2, 2026` / value form `October 2, 2026` / mid-sentence form `due October 2, 2026` (lowercase — subject + preheader). Null `dueAt` → `Due on receipt` / `On receipt` / `due on receipt`. Don't mix them up — `dueDateValue` goes after a "Due" label. |
| `isPaid` / `isUnpaid` / `paidDate` | from `status`/`paidAt` — **re-derived from the invoice's current status at every render**, including SPO-365 resends, never replayed from a stored render. |
| `paypalLink`, `wiseText`, `bankText` | from `rails_snapshot` (frozen at send, never live creator fields). `wiseText`/`bankText` are free multiline text. `paypalLink` must pass `https:`-only scheme validation — see engineering notes. |
| `noRails` | all three rails empty. |
| `hostedInvoiceUrl` | front door + `/i/{public_token}`. Front door is currently `sponsee.vercel.app` (SPO-104) — take it from config, don't hardcode. |

## Design decisions (the "why")

- **Plain text carries the whole invoice.** Number, parties, deal, milestone,
  amount+currency, terms, issued, due, rails, hosted link. The hosted link is
  an *addition*; the text part alone must be filable. Verified as literal text
  for all seven fixture variants.
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
  stress case). Re-verifying this claim: use a **fresh browser context per
  render** — reusing one Playwright `Page` and toggling
  `emulateMedia({media:'print'})` between variants poisons the next
  `page.pdf()` (it paginates at the screen viewport width, falsely splitting
  `stress` to 2 pages). Measured headroom is comfortable, not marginal:
  `stress` ~260px spare, `baseline` ~348px; the contact line costs 24px.
- **Paid state — all three artifacts, not just the page.** Hosted page:
  pine-outline PAID chip in the header, `Paid` date row, label flips to
  "Amount paid", rails replaced by a "This invoice has been paid" note.
  Both email parts flip label, `Paid` date row/sub-line, and rails → paid
  note. The text part additionally marks its title block (`INVOICE INV-0012
  — PAID`); the HTML part deliberately carries **no header marker** — its
  amount card *is* the header, so paid state is signaled there (`Amount
  paid` + `Paid {date}`), not by a chip. Subject and preheader say
  `paid {date}` instead of the due phrase. AP files paid invoices; pay instructions on a settled invoice
  invite double payment. **Resend rule (gates SPO-365):** resending a paid
  invoice re-renders with the *current* status, so the brand gets a
  receipt-style copy carrying no rails and no amount due — a resend must
  never replay the original unpaid render.
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

- Subject: **the template is `invoice-subject.txt`** (rendered per variant as
  `{name}.subject.txt` by `build-previews.mjs` — this block is illustration,
  not source). Unpaid: `Invoice INV-0012 from Nightshade Media — $4,500.00 USD,
  due October 2, 2026`; paid: `…, paid September 18, 2026`.
- Preheader (HTML only): `Invoice {{n}} — {{amount}} {{currency}}, {{dueDatePhrase}}. Payment details inside.`
  (paid: `…, paid {{paidDate}}.`) — followed by an `&#847;&zwnj;&nbsp;` filler
  run so inbox previews don't append the first visible body text.
- Reply hint (both parts + page footer): `Questions about this invoice? Reply to this email — it goes directly to {{creatorDisplayName}}.`

## Engineering notes

- Text part: hard-wrap long values (`dealTitleWrapped`, `milestoneNoteIndented`,
  `wiseTextIndented`, `bankTextIndented`) at 64 content chars with a 2-space
  continuation indent — see `derive()`'s `wrapIndent`. Worst-case rendered
  line (`  Milestone: ` + 64) stays inside the 78-column plain-text
  convention. Words longer than the width (URLs) are left unbroken.
- **`paypalLink`: validate the URL scheme — `https:` only — at snapshot or
  render time, and refuse the send otherwise.** HTML-escaping (which every
  HTML value gets) stops attribute breakout but does NOT stop `javascript:`
  or `data:` URLs, and this value is creator-controlled and rendered as a
  live `href` on the public unauthenticated `/i/:token` page. Escaping is not
  a substitute for scheme validation; `derive()` in `build-previews.mjs` is
  the reference implementation (it throws). The build self-tests the guard:
  four non-`https:` links (`javascript:`, `data:`, `http:`, uppercase
  `HTTPS:` — scheme match is lowercase-strict on purpose) must each throw or
  the build exits 1 before writing any variant.
- Hosted page fonts are the apps/web self-hosted files (`/fonts/…woff2`, see
  `index.css`); previews rewrite to `./fonts/` because they're served flat.
- `noindex, nofollow` meta on the hosted page — tokened URLs must not end up
  in an index.
- Accessibility: single `<h1>`, labeled sections, focus-visible ring on the
  print button, link color pine on white ≥ 4.5:1.
- QA fixture note: the email `View & print invoice` button URL and the plain
  URL under it must both be the hosted link — the QA chain (SPO-358 §6 step 3)
  extracts `/i/:token` from the captured body.
