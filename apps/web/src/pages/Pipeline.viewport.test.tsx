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
import { render, cleanup, screen } from "@testing-library/react";
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

function renderApp() {
  return render(
    <MemoryRouter initialEntries={["/pipeline"]}>
      <MotionProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/pipeline" element={<Pipeline />} />
          </Route>
        </Routes>
      </MotionProvider>
    </MemoryRouter>
  );
}

function board() {
  const el = document.querySelector(".board-scroll");
  if (!el) throw new Error("board-scroll not found — the shell did not render");
  return el as HTMLElement;
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
    renderApp();
    const main = document.querySelector("main");
    expect(main).not.toBeNull();
    // Pins the shell, not the bare page. A future refactor that renders the
    // board standalone (as QA rejected in SPO-369 round 1) silently changes
    // this from 232px and the responsive assertions would be measuring the
    // wrong container.
    expect(getComputedStyle(main as HTMLElement).left).toBe("232px");
  });

  it("fits without horizontal scroll at 1280 and up (SPO-369 F5)", async () => {
    for (const width of [1280, 1366, 1440, 1512]) {
      await page.viewport(width, 900);
      renderApp();
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
      renderApp();
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

  it("keeps exactly one visible copy of the value note at every width (SPO-376 N3)", async () => {
    for (const width of [900, 1024, 1280, 1366, 1440, 1512]) {
      await page.viewport(width, 900);
      renderApp();
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
});
