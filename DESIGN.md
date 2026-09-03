---
name: Sponsee
description: Sponsorship CRM for mid-tier live streamers — a calm business tool on warm paper
colors:
  pine: "#0E7A5F"
  pine-hover: "#0B664F"
  pine-tint: "#E4F1EB"
  paper: "#F7F5F1"
  surface: "#FFFFFF"
  surface-subtle: "#FBFAF7"
  ink: "#1B1815"
  ink-2: "#57504A"
  ink-3: "#757069"
  hairline: "#E8E3DB"
  amber: "#B87208"
  amber-tint: "#FAF0DC"
  brick: "#B3402A"
  brick-tint: "#F9E7E1"
  twitch: "#8B5CF6"
  youtube: "#E5484D"
  kick: "#58A617"
  tiktok: "#1B1815"
  scrollbar: "#C9C2B6"
typography:
  display:
    fontFamily: "'Instrument Serif', Georgia, serif"
    fontSize: "22px"
    fontWeight: 400
    lineHeight: 1.2
  headline:
    fontFamily: "'Instrument Serif', Georgia, serif"
    fontSize: "19px"
    fontWeight: 400
    lineHeight: 1.2
  figure:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 600
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    letterSpacing: "0.08em"
  scale:
    micro: "10px"
    label: "11px"
    dense: "12px"
    body: "13px"
    body-lg: "14px"
    title: "15px"
    emphasis: "18px"
    headline: "19px"
    figure-serif: "20px"
    display: "22px"
    figure: "26px"
    greeting: "28px"
    greeting-lg: "34px"
    hero: "48px"
rounded:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "14px"
  pill: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  2xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.pine}"
    textColor: "#FFFFFF"
    rounded: "{rounded.lg}"
    padding: "0 12px"
    height: "32px"
  button-primary-hover:
    backgroundColor: "{colors.pine-hover}"
  button-quiet:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.lg}"
    padding: "0 12px"
    height: "32px"
  chip:
    rounded: "{rounded.pill}"
    padding: "2px 10px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    padding: "20px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "8px 12px"
---

# Design System: Sponsee

## Overview

**Creative North Star: "The Warm-Paper Ledger"**

Sponsee looks like a well-kept ledger on warm paper: a calm, professional back office for one person managing real money. Every neutral carries a warm cast — the background is paper, not gray; text is ink, not black; borders are hairlines the color of aged paper. Against that quiet ground, a single deep pine green does all the interactive work, and money is always set in tabular figures. Density is moderate: 13px body type, 20px card padding, generous whitespace between financial groupings so the eye can total a column.

The system is deliberately the opposite of streamer-tool convention. No dark mode by default, no neon, no gradients, no glassmorphism, no gamer RGB — those read as the platforms the creator streams on, not the business that pays their rent. Platform identity (Twitch violet, YouTube red, Kick green) is confined to tiny dots and chips, the way a paper planner uses colored stickers.

**Key Characteristics:**
- Warm neutrals everywhere; zero pure grays or pure black.
- One interactive accent (deep pine); amber and brick reserved for attention and danger.
- Serif display type over sans body — an editorial, "professional assistant" voice.
- Financial figures are semibold, tabular, and tightly tracked.
- Flat surfaces with hairline borders; warm shadows appear on hover and overlays only.

## Colors

A warm-paper neutral ramp with one working accent and two reserved signal colors.

### Primary
- **Pine** (#0E7A5F): the only interactive color — primary buttons, links, focus rings, active nav, selected states, "paid" status. Hover deepens to **Pine Hover** (#0B664F); **Pine Tint** (#E4F1EB) backs positive chips and selected/hover fills.

### Secondary
- **Amber** (#B87208): attention without alarm — "negotiating," "in progress," due-soon. Always paired with **Amber Tint** (#FAF0DC) as chip background.
- **Brick** (#B3402A): danger and overdue — missed deliverables, late invoices, destructive actions. Chip background **Brick Tint** (#F9E7E1).

### Neutral
- **Paper** (#F7F5F1): the app background. Nothing else is this color.
- **Surface** (#FFFFFF): cards, popovers, inputs, toasts. **Surface Subtle** (#FBFAF7): quiet fills — kbd hints, disabled chips, secondary panels.
- **Ink** (#1B1815): primary text and figures. **Ink 2** (#57504A): secondary text. **Ink 3** (#757069): captions, eyebrows, placeholder text.
- **Hairline** (#E8E3DB): every border and divider. Inputs sharpen to pine on focus, not to a darker gray.
- **Scrollbar** (#C9C2B6): the one darker warm neutral — the always-visible thumb on horizontally clipped regions (`.board-scroll`), so off-screen pipeline columns stay discoverable.

### Tertiary (platform marks)
- **Twitch** (#8B5CF6), **YouTube** (#E5484D), **Kick** (#58A617), **TikTok** (rendered as Ink #1B1815 — the neon cyan/magenta mark is off-palette by decision, SPO-193). Used only in `PlatformDot` / `PlatformChip` indicators.

### Named Rules
**The Warm Cast Rule.** No pure gray, no pure black, anywhere. Every neutral comes from the paper/ink ramp above; a `#EEE` border or `#333` text is a defect.
**The One Accent Rule.** Pine is the only color that means "interactive." Amber and brick are statuses, never buttons or links. If a screen looks colorful, it is wrong.
**The Sticker Rule.** Platform brand colors appear only as small dots and chips (≤8px dots), never as surface, text, or button colors.

## Typography

**Display Font:** Instrument Serif (with Georgia fallback) — self-hosted, 400 normal + italic only
**Body Font:** Inter (with system-ui fallback) — self-hosted at 400/500/600/700
**Label/Mono Font:** JetBrains Mono (with ui-monospace fallback) for kbd hints and code-like values

**Character:** An editorial serif voice over a workmanlike sans — the product sounds like a competent human assistant, and the type pairing matches: Instrument Serif gives page titles and hero figures a personal, letterhead quality; Inter does the quiet operational work.

This stack is a committed brand decision (PRD §1.4, founder-approved), not a default. Impeccable's `overused-font` detector flags Inter and Instrument Serif as saturated choices; for Sponsee they are accepted deliberately — Inter for dense financial UI legibility, Instrument Serif as the distinguishing display voice — and the detector carries value-specific ignores for both in `.impeccable/config.json`. Note: JetBrains Mono is declared in the Tailwind stack but not yet self-hosted in `public/fonts`, so `font-mono` currently renders the system mono fallback; financial figures rely on Inter + tabular numerals, not the mono face.

### Hierarchy
- **Display** (400, 22px, serif): section-defining titles (Settings) and hero serif figures on Dashboard/Payments summary tiles (20–22px, `leading-none`).
- **Headline** (400, 19px, serif): page titles — Dashboard, Pipeline, Payments, Calendar.
- **Figure** (600, 26px, −0.02em, `.tnum`): the KPI number on stat cards; always tabular.
- **Body** (400–500, 13–14px): all operational text, table cells, buttons (500).
- **Label** (600, 11px, +0.08em, UPPERCASE): eyebrows above figures, column headers, nav group labels, chip text (no uppercase on chips).

The full pixel ramp in use (frontmatter `typography.scale`): 10 (micro chips), 11 (labels), 12 (dense tables), 13 (body), 14 (large body), 15 (panel/modal titles), 18 (emphasized figures and inputs), 19/20/22 (serif headline, serif figure, display), 26 (KPI figures and the auth hero), 28/34 (the dashboard greeting — one responsive serif display, 28 at base and 34 from `sm:` up; no other use), 48 (hero figures — the 404 and calculator result). A literal `text-[Npx]` off this ramp is drift; add a step here deliberately or use the nearest one.

### Named Rules
**The Serif-Is-Display Rule.** Instrument Serif appears only in page titles and hero figures. Serif body text or serif UI controls are defects.
**The Tabular Money Rule.** Every financial figure takes `.tnum` (tabular numerals). Proportional digits in a money column are a defect.

## Layout

App shell: fixed 232px sidebar (off-canvas drawer below `lg`), 56px topbar, and an internally scrolling content region capped at `max-w-[1360px]` with 16px padding (24px from `sm` up). Pages open with a serif title row plus right-aligned actions, then content in cards. KPI rows are responsive grids of stat cards; the pipeline is a horizontally scrolling kanban with an always-visible thin scrollbar (`.board-scroll`) so clipped columns are discoverable. Spacing follows Tailwind's 4px grid — 20px card padding, 12px gaps in dense lists, 24px between page sections. Body copy and labels sit flush-left; numbers right-align in table columns.

## Elevation & Depth

Structure comes from hairline borders, not shadows: surfaces are flat white cards on paper. Shadows are warm (ink-tinted, `rgba(27,24,21,…)`) and respond to state — a resting card wears the barely-there `shadow-warm`, lifts to `shadow-warm-md` with a 1px translate on hover, and only floating layers (dialogs, popovers, command palette) use `shadow-warm-lg`.

### Shadow Vocabulary
- **warm** (`0 1px 2px rgba(27,24,21,.05)`): resting cards.
- **warm-md** (`0 4px 16px rgba(27,24,21,.08), 0 1px 3px rgba(27,24,21,.06)`): hover lift, toasts, dropdown menus.
- **warm-lg** (`0 12px 40px rgba(27,24,21,.14)`): modals and the command palette.

### Named Rules
**The Flat-At-Rest Rule.** Depth is a response to interaction or layering, never decoration. No shadow ever appears on a static, non-interactive element beyond `shadow-warm`.

## Shapes

Gently rounded, never bubbly: the radius scale derives from a 10px base (`--radius: 0.625rem`) — 10px (`lg`) for buttons and inputs, 14px (`xl`) for cards, 8px and below for nested elements, and full pills for status chips, delta chips, and platform dots. Borders are 1px hairline throughout; there are no 2px borders and no dashed strokes except drag-target affordances. Nothing is a sharp-cornered rectangle, and nothing exceeds 14px radius except pills and the one standalone auth card, which steps up to 16px as a lone centered surface.

## Components

### Buttons
- **Shape:** gently rounded (10px), 32px tall in toolbars (28px in dense table rows), 13px medium Inter, 12px horizontal padding.
- **Primary:** pine background, white text; hover shifts to pine-hover via a 150ms color transition; disabled at 50% opacity. Icon + label sit with a 6px gap.
- **Hover / Focus:** color-only transitions at rest; focus is always `focus-visible:ring-2 ring-pine` (30% tint on cards), never outline suppression without a ring.
- **Quiet / Secondary:** white surface with hairline border, ink-2 text warming to ink on hover — used for filters, pagination, "view all."

### Chips
- **Style:** full-pill, 11px semibold, 10px horizontal padding; tone pairs are always tint-background + deep-foreground (pine-tint/pine, amber-tint/amber, brick-tint/brick, ink-6%/ink-2).
- **State:** the `StatusChip` maps every domain enum (deal, invoice, deliverable, contract) to a tone; a live deal's chip carries a 6px pulsing pine dot. Derived states ("Overdue", "Due in 3d") pass explicit tone + label.

### Cards / Containers
- **Corner Style:** 14px.
- **Background:** surface white on paper; surface-subtle for nested quiet panels.
- **Shadow Strategy:** `shadow-warm` at rest; interactive cards add hover lift (see Elevation).
- **Border:** 1px hairline, always.
- **Internal Padding:** 20px.

### Inputs / Fields
- **Style:** surface background, hairline border, 10px radius, 13px text, ink-3 placeholder.
- **Focus:** border sharpens to pine (`focus:border-pine`) with no ring on inline form fields; standalone focus targets use the pine ring.
- **Error / Disabled:** brick border + brick helper text; disabled drops to 50% opacity.

### Navigation
- **Sidebar:** 232px, paper-toned, 13px items with 16px icons; active item takes pine-tint fill + pine text, hover warms text from ink-2 to ink. Group labels use the uppercase 11px label style.
- **Topbar:** 56px, hairline bottom border, houses search (⌘K command palette in a 560px `shadow-warm-lg` panel) and account controls.

### Stat Card (signature component)
The KPI unit of the whole product: uppercase 11px eyebrow, a 26px tabular count-up figure, an optional pill delta chip (tone-mapped), a caption line, and an optional pine sparkline that draws on entrance. Clickable stat cards reveal an arrow affordance and lift on hover. Cards stagger in with the house entrance motion.

### Motion
One easing curve for the entire product — `cubic-bezier(0.22, 1, 0.36, 1)` from `@/lib/motion` — with a named duration scale (fast 0.18s, base 0.22s, entrance 0.32s, grow 0.6s, draw 0.8s) and stagger steps (0.04/0.06/0.08s). Entrances rise 12px and fade; charts grow and draw; counts tween over 0.8s. `prefers-reduced-motion` is honored. **The One Curve Rule.** Never introduce a second easing curve or ad-hoc duration; import from `@/lib/motion`.

## Do's and Don'ts

### Do:
- **Do** use pine (#0E7A5F) for every interactive affordance and only for interactive affordances or positive status.
- **Do** set every financial figure in `.tnum` tabular numerals, right-aligned in columns.
- **Do** pair every chip tone as tint background + deep foreground (never solid saturated fills for statuses other than `paid`/`delivered`).
- **Do** keep serif type to page titles and hero figures at 19–22px.
- **Do** import easing, durations, and stagger from `@/lib/motion` for any animation.
- **Do** give every focusable element a visible `ring-pine` focus state.

### Don't:
- **Don't** introduce pure grays, pure black, gradients, glassmorphism, dark-neon, or any gamer-RGB styling — this is a business tool on warm paper.
- **Don't** use platform brand colors beyond small dots and chips; never render TikTok in neon cyan/magenta (it is ink here).
- **Don't** add fonts beyond Inter, Instrument Serif, and JetBrains Mono, or load fonts from a CDN — faces are self-hosted (SPO-25).
- **Don't** exceed 14px corner radius on in-app containers (the standalone auth card's 16px is the only exception) or use sharp corners; pills are for chips only.
- **Don't** put shadows on static decoration or use cool-toned (`rgba(0,0,0,…)`) shadows heavier than the `xs` utility.
- **Don't** use amber or brick as button or link colors; they are status signals only.
