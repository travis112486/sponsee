/**
 * SPO-379: responsive / media-query regression coverage in a REAL browser.
 *
 * jsdom cannot evaluate media queries, so every `lg:` / `min-[1440px]:` variant
 * on the pipeline board is invisible to Pipeline.test.tsx — mutation A below
 * (dropping the SPO-376 band classes) leaves that suite green while the board
 * visibly clips. This file renders the same component through the real app
 * shell (Layout's 232px sidebar + the max-w-[1360px] p-6 content box) in
 * Chromium and asserts MEASURED geometry, not DOM counts.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import { page } from "vitest/browser";
import type { ReactNode } from "react";
import Layout from "@/components/Layout";
import { MotionProvider } from "@/components/MotionProvider";
import Pipeline from "./Pipeline";
import "@/index.css";

import { dealStages } from "@sponsee/shared";

// Stage list comes from @sponsee/shared, never retyped here. A hand-written
// list of invented stages silently produced an empty board in the spike — the
// real byStage lookup keys on these exact strings.
const STAGES = [...dealStages];

const deals = STAGES.map((stage, i) => ({
  id: `d${i}`,
  title: `Q4 Campaign ${i}`,
  type: "flat",
  stage,
  valueCents: 2400000,
  valueNote: "per stream",
  currency: "USD",
  paymentTerms: "net_30",
  stageEnteredAt: new Date(Date.now() - 2 * 86400000).toISOString(),
  brand: { name: "Voltaic Energy", domain: null as string | null },
  platforms: ["twitch", "youtube"],
  notes: null,
  deliverables: [
    {
      id: `del${i}`,
      // Load-bearing: the clip check below measures THIS title's overflow, and
      // its width sits ~0.5px from the band column's clip boundary — rename it
      // ("VOD") and mutation A ships green. The flex-direction test is the
      // categorical guard (string-independent); this clip check is the
      // width-sensitive secondary, so keep the string's width in mind on tidy-up.
      title: "VOD publish",
      status: "not_started",
      dueAt: null,
      dueLabel: null,
      progressDone: 137,
      progressTotal: 200,
      position: 0,
    },
  ],
  invoices: [],
}));

const noop = vi.fn();
const q = (data: unknown) => ({ data, isLoading: false, isError: false, refetch: noop });

vi.mock("@/trpc", () => ({
  trpc: {
    useUtils: () => ({
      deals: { list: { invalidate: noop } },
      brand: { list: { invalidate: noop }, contacts: { invalidate: noop } },
      invoice: { list: { invalidate: noop } },
    }),
    deals: {
      list: { useQuery: () => q(deals) },
      updateStage: { useMutation: () => ({ mutate: noop, isPending: false }) },
      create: { useMutation: () => ({ mutate: noop, isPending: false }) },
    },
    invoice: {
      list: { useQuery: () => q([]) },
      create: { useMutation: () => ({ mutate: noop, isPending: false }) },
    },
    deliverable: { update: { useMutation: () => ({ mutate: noop, isPending: false }) } },
    settings: { getProfile: { useQuery: () => q({ timezone: "UTC" }) } },
    brand: {
      list: { useQuery: () => q([]) },
      create: { useMutation: () => ({ mutateAsync: noop }) },
      contacts: { useQuery: () => q([]) },
      addContact: { useMutation: () => ({ mutate: noop, mutateAsync: noop, isPending: false }) },
    },
    // The app shell (Navbar/Topbar) issues its own queries — Layout will not
    // render without them, and a bare page render is exactly what QA rejected
    // in SPO-369 round 1 for dropping the 232px sidebar.
    billing: { getSubscription: { useQuery: () => q({ plan: "starter", status: "active" }) } },
    activity: { list: { useQuery: () => q([]) } },
  },
  TRPCProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { id: "u1", name: "Creator", email: "creator@example.com" },
    isLoading: false,
    isAuthenticated: true,
    signIn: noop,
    signOut: noop,
  }),
  AuthProvider: ({ children }: { children: ReactNode }) => children,
}));

// The real hook derives identity from settings.getProfile + settings.getPlatforms.
// Mocking it directly keeps the shell render free of the platform-rows query.
vi.mock("@/lib/use-creator-identity", () => ({
  useCreatorIdentity: () => ({ name: "Creator", avatarUrl: null, subtitle: null }),
}));

afterEach(() => cleanup());

async function renderApp(path = "/pipeline") {
  render(
    <MemoryRouter initialEntries={[path]}>
      <MotionProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/pipeline" element={<Pipeline />} />
          </Route>
        </Routes>
      </MotionProvider>
    </MemoryRouter>
  );
  // Self-hosted Inter loads lazily. A measurement taken before it resolves
  // reads fallback metrics (~0.8px wider title) and eats most of the clip
  // assertion's +1px tolerance. Awaiting the font set makes every measurement
  // run against final metrics regardless of test order, so `-t` isolation or a
  // reorder can't change what's measured.
  await document.fonts.ready;
}

function board() {
  const el = document.querySelector(".board-scroll");
  if (!el) throw new Error("board-scroll not found — the shell did not render");
  return el as HTMLElement;
}

// The deliverable row is the flex container whose `flex-direction` the SPO-376
// N2 band classes control: stacked `column` in the lg–1439 band, one `row`
// from 1440. Mutation A drops those classes and the band silently flips to
// `row`. Located via the deliverable-title `<p>` (its parent is the row), the
// same selector the clip check uses.
function deliverableRows() {
  return [...document.querySelectorAll<HTMLElement>('p[title="VOD publish"]')]
    .map((t) => t.parentElement)
    .filter((el): el is HTMLElement => el !== null);
}

// Non-vacuity guard: the board must actually hold one card per stage. If the
// fixture or the selector drift and this is zero, every geometry assertion that
// follows would be measuring an empty board and could still read green.
function assertCardsRendered(expected: number) {
  const cards = document.querySelectorAll('[aria-roledescription="Draggable deal card"]');
  expect(cards.length, "rendered deal cards").toBe(expected);
}

describe("Pipeline responsive geometry (real browser)", () => {
  it("renders through the real Layout shell (232px sidebar present)", async () => {
    await page.viewport(1280, 900);
    await renderApp();
    const main = document.querySelector("main");
    expect(main).not.toBeNull();
    // Pins the shell, not the bare page. A future refactor that renders the
    // board standalone (as QA rejected in SPO-369 round 1) silently changes
    // this from 232px and the responsive assertions would be measuring the
    // wrong container.
    expect(getComputedStyle(main as HTMLElement).left).toBe("232px");
  });

  it("fits without horizontal scroll at 1280 and up (SPO-369 F5)", async () => {
    // Fit budget at 1280: the content column is 1000px (min(1360, 1280-232) -
    // 48) and the column floor needs 6 x 156 + 5 x 8 = 976px, leaving 24px of
    // headroom. A seventh stage in dealStages — or a gap bump — needs 1140px
    // and silently breaks this no-scroll guarantee, so keep this budget in mind
    // before editing either. At 1024 the board legitimately overflows by 232px;
    // the guarantee correctly starts at 1280, not lg.
    for (const width of [1280, 1366, 1440, 1512]) {
      await page.viewport(width, 900);
      await renderApp();
      assertCardsRendered(deals.length);
      const b = board();
      expect(b.clientWidth, `board clientWidth > 0 at ${width}`).toBeGreaterThan(0);
      expect(
        { width, scrollWidth: b.scrollWidth, clientWidth: b.clientWidth },
        `board must not scroll at ${width}`
      ).toEqual({ width, scrollWidth: b.clientWidth, clientWidth: b.clientWidth });
      cleanup();
    }
  });

  it("does not clip deliverable titles in the 1024-1439 band (SPO-376 N2)", async () => {
    for (const width of [1024, 1280, 1366]) {
      await page.viewport(width, 900);
      await renderApp();
      assertCardsRendered(deals.length);
      const titles = [
        ...document.querySelectorAll<HTMLElement>('p[title="VOD publish"] span.truncate'),
      ];
      // Non-vacuity guard: an empty selector would make the clip assertion
      // below trivially true, which is how a broken responsive test ships green.
      expect(titles.length, `deliverable titles found at ${width}`).toBe(deals.length);
      const clipped = titles.filter((t) => t.scrollWidth > t.clientWidth + 1);
      expect(clipped.length, `clipped deliverable titles at ${width}`).toBe(0);
      cleanup();
    }
  });

  it("stacks the deliverable row in the 1024-1439 band, one row from 1440 (SPO-376 N2 geometry)", async () => {
    // Categorical, not clip-based: asserts the computed flex-direction the
    // band classes actually control. Mutation A (drop the band classes) flips
    // the band from `column` to `row`, and an empty Tailwind stylesheet also
    // resolves `row` — so this fails loudly in both cases instead of measuring
    // naked DOM. This is the string-independent guard the clip check is not.
    for (const width of [1024, 1280, 1366]) {
      await page.viewport(width, 900);
      await renderApp();
      assertCardsRendered(deals.length);
      const rows = deliverableRows();
      // Non-vacuity guard: an empty row list would make the flex-direction
      // assertion below trivially true.
      expect(rows.length, `deliverable rows found at ${width}`).toBe(deals.length);
      for (const row of rows) {
        expect(getComputedStyle(row).flexDirection, `deliverable row stacks at ${width}`).toBe(
          "column"
        );
      }
      cleanup();
    }
    for (const width of [1440, 1512]) {
      await page.viewport(width, 900);
      await renderApp();
      assertCardsRendered(deals.length);
      const rows = deliverableRows();
      expect(rows.length, `deliverable rows found at ${width}`).toBe(deals.length);
      for (const row of rows) {
        expect(getComputedStyle(row).flexDirection, `deliverable row single-line at ${width}`).toBe(
          "row"
        );
      }
      cleanup();
    }
  });

  it("keeps exactly one visible copy of the value note at every width (SPO-376 N3)", async () => {
    for (const width of [900, 1024, 1280, 1366, 1440, 1512]) {
      await page.viewport(width, 900);
      await renderApp();
      assertCardsRendered(deals.length);
      const notes = [...screen.queryAllByText("per stream")];
      // Non-vacuity guard: the note is rendered twice in the DOM (inline copy +
      // band copy) at every width, so before measuring visibility we pin the
      // DOM copy count — a zero here means the selector drifted and the
      // visibility assertion would be covering nothing.
      expect(notes.length, `value-note DOM copies at ${width}`).toBe(2 * deals.length);
      // Visibility is measured, not counted: display:none collapses offsetParent
      // to null, so exactly one of the two copies should be visible per deal.
      const visible = notes.filter((n) => (n as HTMLElement).offsetParent !== null);
      expect(visible.length, `visible value notes at ${width}`).toBe(deals.length);
      cleanup();
    }
  });

  it("keeps the New-deal modal actionable at 900px height in New-brand mode (SPO-396)", async () => {
    // The width sweeps above run at a fixed tall height, so height overflow is
    // invisible to them — this is the 1440x900 (default MacBook logical
    // resolution) case that pins SPO-396. `?new=1` is the same URL contract
    // CommandPalette uses to open the modal.
    await page.viewport(1440, 900);
    await renderApp("/pipeline?new=1");
    const vh = window.innerHeight;
    expect(vh, "viewport height took effect").toBe(900);

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog, "New-deal dialog rendered").not.toBeNull();

    // Enter the taller variant: SPO-369's Website/Category/Contact fields are
    // what push the panel past 900px.
    fireEvent.click(screen.getByRole("button", { name: "New brand" }));

    // Non-vacuity guard: this viewport must actually be too short for the
    // New-brand form. If a future redesign shrinks the form below ~850px the
    // scroll assertions below stop covering anything — move the height down
    // rather than deleting the case.
    const form = dialog!.querySelector("form");
    expect(form, "modal form rendered").not.toBeNull();
    expect(
      form!.scrollHeight,
      "New-brand form content taller than its scrollport at 900px"
    ).toBeGreaterThan(form!.clientHeight);

    // The panel itself must fit on-screen (it used to center at 1118px tall
    // and clip ~110px at BOTH ends).
    const panel = dialog!.getBoundingClientRect();
    expect(panel.top, "panel top on-screen").toBeGreaterThanOrEqual(0);
    expect(panel.bottom, "panel bottom on-screen").toBeLessThanOrEqual(vh);

    // Create deal / Cancel are mouse-reachable: scrolling the form brings them
    // fully into the viewport. Pre-fix this was a no-op (no scrollable
    // ancestor) and Create deal's rect sat at top=963 vs a 900px viewport.
    const createBtn = screen.getByRole("button", { name: "Create deal" });
    const cancelBtn = screen.getByRole("button", { name: "Cancel" });
    createBtn.scrollIntoView({ block: "nearest" });
    for (const [label, btn] of [["Create deal", createBtn], ["Cancel", cancelBtn]] as const) {
      const r = btn.getBoundingClientRect();
      expect(r.height, `${label} has real size`).toBeGreaterThan(0);
      expect(r.top, `${label} top on-screen after scroll`).toBeGreaterThanOrEqual(0);
      expect(r.bottom, `${label} bottom on-screen after scroll`).toBeLessThanOrEqual(vh);
    }

    // The header (title + Close) is pinned outside the scroll region: still
    // fully visible even with the form scrolled to its far end.
    const titleRect = document.getElementById("new-deal-title")!.getBoundingClientRect();
    expect(titleRect.top, "modal header stays on-screen").toBeGreaterThanOrEqual(0);
    expect(titleRect.height, "modal header has real size").toBeGreaterThan(0);
  });
});
