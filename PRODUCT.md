# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Mid-tier live streamers on Twitch, YouTube Live, TikTok Live, and Kick — 100–5,000 concurrent viewers, $20K–$200K/yr revenue, roughly half of it from sponsorships. Canonical persona "PixelPanda": 850 CCV variety streamer, 4–10 brand deals per quarter at $400–$3,200 each, working alone or with a part-time editor, no manager. Secondary: full-time YouTubers/podcasters with the same deal-ops problem (the product must never be Twitch-only in language or data model). Anti-personas: esports orgs, brands/agencies, and sub-100-CCV hobbyists — do not design for them.

## Product Purpose

Sponsee is a sponsorship CRM that turns brand deals from DM chaos into a managed business: a deal pipeline, benchmark-priced offers, tracked deliverables, and automatic late-payment chasing — without ever touching the creator's money. Success is $10K MRR from 400+ paying creators within 12 months of launch, with ≥8% free→paid conversion and <5% monthly churn.

## Positioning

Flat-fee deal-ops for the creator's side of the table. Incumbents either take a revenue share (marketplaces), serve marketers rather than talent (enterprise influencer platforms), or lack deal-ops depth (link-in-bio tools). Sponsee's claim a neighbor cannot truthfully copy: it runs the whole sponsorship back office — pipeline, CPVH-benchmarked pricing ($0.60–$1.50 per viewer-hour), deliverables, and dignified payment chasing — for a flat $19/$29/$39 per month, taking no cut and holding no funds.

## Operating Context

A solo creator manages real money in the gaps between streams. Deals arrive in DMs and email; obligations live in contracts nobody reopens; 48–87% of creators report being paid late, and chasing a brand personally is socially costly — the chase email must read like a professional assistant wrote it, not a robot. Brands interact only through email and read-only links; there is no brand-side product in v1. The app's surfaces: Dashboard, Deal Pipeline (kanban), Deal Detail workspace, Rate Calculator (also the public lead magnet), Deliverable Calendar, Payments & invoice chasing, Settings.

## Capabilities and Constraints

- Core loop: capture a deal → price it against CPVH benchmarks → track deliverables → invoice → auto-chase until paid.
- Deal stages: inbound → negotiating → contract_sent → live → delivered → paid. Invoice statuses: draft / open / paid / void. Deliverable statuses: not_started / scheduled / in_progress / done / missed / rescheduled. Contract statuses: draft / sent / viewed / signed.
- Terminology: CCV (concurrent viewers), CPVH (cost per viewer-hour), chase sequence, deliverable, benchmark band.
- Platform metrics come from official APIs where feasible; a manual-entry fallback must always exist (Kick API access is unreliable). Never scrape against ToS.
- Pricing: $19 Starter / $29 Creator / $39 Pro flat tiers; 14-day trial without a card; free tier is the rate calculator only.
- Hard rules (binding, board-level): no custody of creator funds and no money movement, ever — invoices point to the creator's own rails; no marketplace mechanics and no revenue share on deals; no enterprise/esports-org features before the mid-tier core loop retains; no fan monetization; no fabricated social proof. Copy audit: say "we help you chase payment," never "we get you paid."
- Stack (existing): React 19 + TypeScript + Vite + Tailwind v3.4 + shadcn/ui; Hono + tRPC + Drizzle + Postgres. Performance budget: app shell <150KB initial JS gz, views <300ms p75 interactive.

## Brand Commitments

- Name: Sponsee (use ™ until registered). Where platforms are referenced, include "Sponsee is not affiliated with Twitch/YouTube/Kick."
- Visual identity is a calm business tool on a warm-paper palette — explicitly **no gamer RGB, no dark-neon esports aesthetic**. Palette direction changes require board sign-off.
- Type stack committed in the approved PRD: Inter (UI), Instrument Serif (display), JetBrains Mono (numbers).
- Platform brand colors (Twitch violet, YouTube red, Kick green) appear only in small indicators; TikTok is rendered as ink, never neon.

## Evidence on Hand

- 63-page cited market study (`streamer-saas-market-gaps`): sponsorship CRM for mid-tier creators scored 7/10 GO; 48–87% late-payment stat; CPVH benchmarks $0.60–$1.50 (agency deals to ~$2.00).
- Founder-approved PRD v1.0 (2026-08-26) and an approved interactive mockup of all seven screens — the UX source of truth.
- No real testimonials, customer logos, or user counts exist yet; none may be invented anywhere in the product or marketing.

## Product Principles

1. **Clarity for one person managing real money.** Every screen answers "what's owed, what's due, what's next" — never dashboard clutter.
2. **Chasing is delegated dignity.** The product absorbs the social cost of asking to be paid; everything it sends must sound like a competent human assistant.
3. **Benchmarks before negotiation.** Creators see market rates (CPVH) before they anchor to a brand's first number.
4. **Money moves elsewhere.** Sponsee mirrors payment status; it never holds, collects, or routes funds.
5. **Mid-tier first.** Features are judged by what the 100–5K CCV solo creator needs; agency and org needs wait.

## Accessibility & Inclusion

WCAG 2.1 AA on core flows (PRD requirement). The motion system honors `prefers-reduced-motion`. Financial figures use tabular numerals for scanability.
