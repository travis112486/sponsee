import type { DeliverableStatus } from "@sponsee/shared";

/**
 * Calendar deliverable status tokens (SPO-414).
 *
 * The calendar renders status as a bordered chip in the month grid and a dot in
 * the Upcoming sidebar — a different form from the `StatusChip` pill, which is
 * why the classes live here rather than as another `tone` on that component.
 * Copy is *not* duplicated: the words come from `deliverableLabels`, which
 * `StatusChip` already owns.
 *
 * Both maps are `Record<DeliverableStatus, …>`, so a seventh status added to
 * `@sponsee/shared` reds this file instead of rendering an unstyled chip.
 *
 * Lives outside `CalendarPage.tsx` for the same reason as `platform-tokens.ts`:
 * a page file that also exports constants trips react-refresh.
 *
 * ── Why `scheduled` and `rescheduled` share a hue ──
 * DESIGN.md budgets one working accent (pine) and three signal colours (amber,
 * brick, denim). Six deliverable statuses do not get six hues out of that, and
 * inventing a seventh warm hue would not actually help: at six categories a
 * warm ramp is already past what common colour-vision deficiencies can
 * separate. So the pair shares amber and is told apart on a *non-colour*
 * channel — a dashed border on the chip, a hollow ring on the dot — with the
 * status also written out in words at every render site (WCAG 1.4.1).
 *
 * That last part is the load-bearing half. This page previously had no label
 * map at all, so the dot was the only status channel anywhere on the screen;
 * `CalendarPage.test.tsx` pins both the distinctness and the rendered words.
 */
export const deliverableStatusColors: Record<DeliverableStatus, string> = {
  done: "bg-pine-tint text-pine border-pine/20",
  in_progress: "bg-denim-tint text-denim border-denim/20",
  scheduled: "bg-amber-tint text-amber border-amber/20",
  not_started: "bg-surface-subtle text-ink-3 border-hairline",
  missed: "bg-brick-tint text-brick border-brick/20",
  rescheduled: "bg-amber-tint text-amber border-amber/20 border-dashed",
};

export const deliverableStatusDot: Record<DeliverableStatus, string> = {
  done: "bg-pine",
  in_progress: "bg-denim",
  scheduled: "bg-amber",
  not_started: "bg-ink-3",
  missed: "bg-brick",
  // Hollow ring, not a solid fill — the same non-colour split as the chip.
  rescheduled: "bg-surface ring-2 ring-inset ring-amber",
};
