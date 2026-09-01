// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  contractStatuses,
  dealStages,
  deliverableStatuses,
  invoiceStatuses,
  platforms,
} from "@sponsee/shared";

import { BrandMark, brandInitials } from "./BrandMark";
import { PlatformChip, PlatformDot, PlatformDots } from "./PlatformDot";
import { Sparkline } from "./Sparkline";
import { StatCard } from "./StatCard";
import { StatusChip } from "./StatusChip";

afterEach(cleanup);

describe("PlatformDot", () => {
  it("labels each platform and colours it from a brand token", () => {
    // Literals, not a map lookup: a silent recolour to a raw Tailwind palette
    // class is exactly what this should catch.
    const { container } = render(<PlatformDot platform="twitch" />);
    const dot = container.querySelector("span")!;
    expect(dot).toHaveClass("bg-twitch");
    expect(dot).toHaveAttribute("aria-label", "Twitch");
  });

  it("covers every platform in the shared union", () => {
    for (const p of platforms) {
      const { container, unmount } = render(<PlatformDot platform={p} />);
      const cls = container.querySelector("span")!.className;
      expect(cls).toContain(`bg-${p}`);
      // No raw palette escape (bg-purple-500, bg-black, …)
      expect(cls).not.toMatch(/bg-(?:slate|gray|zinc|neutral|stone|red|blue|purple|green)-\d/);
      unmount();
    }
    expect(platforms).toContain("tiktok");
  });

  it("renders one dot per platform on a deal", () => {
    const { container } = render(<PlatformDots platforms={["twitch", "kick"]} />);
    expect(container.querySelectorAll("[aria-label]")).toHaveLength(2);
  });

  it("shows a short code in the chip form", () => {
    render(<PlatformChip platform="youtube" />);
    expect(screen.getByText("YT")).toBeInTheDocument();
  });
});

describe("BrandMark", () => {
  it("takes the first letter of the first two words", () => {
    expect(brandInitials("Logitech G")).toBe("LG");
    expect(brandInitials("Red Bull Energy")).toBe("RB");
  });

  it("takes two letters from a single-word brand", () => {
    expect(brandInitials("Elgato")).toBe("EL");
  });

  it("does not crash on an empty or whitespace-only name", () => {
    expect(brandInitials("")).toBe("?");
    expect(brandInitials("   ")).toBe("?");
  });

  it("scales the type with the tile", () => {
    const { container } = render(<BrandMark brand="Nvidia Studio" size={40} />);
    const tile = container.querySelector("span")!;
    expect(tile).toHaveTextContent("NS");
    expect(tile.style.width).toBe("40px");
    expect(tile.style.fontSize).toBe("14px");
  });
});

describe("StatusChip", () => {
  it("renders the domain label for a deal stage", () => {
    render(<StatusChip kind="deal" status="contract_sent" />);
    expect(screen.getByText("Contract Sent")).toBeInTheDocument();
  });

  it("disambiguates statuses that collide across enums", () => {
    // `paid` exists on both deals and invoices; `draft` on both invoices and
    // contracts. The mockup's single flat union could not express this.
    const { container: dealPaid } = render(<StatusChip kind="deal" status="paid" />);
    const { container: invoicePaid } = render(<StatusChip kind="invoice" status="paid" />);
    expect(dealPaid.firstElementChild).toHaveClass("bg-pine");
    expect(invoicePaid.firstElementChild).toHaveClass("bg-pine");

    const { container: invoiceDraft } = render(<StatusChip kind="invoice" status="draft" />);
    const { container: contractDraft } = render(
      <StatusChip kind="contract" status="draft" />
    );
    expect(invoiceDraft).toHaveTextContent("Draft");
    expect(contractDraft).toHaveTextContent("Draft");
  });

  it("gives the live deal stage a pulse indicator", () => {
    const { container } = render(<StatusChip kind="deal" status="live" />);
    expect(container.querySelector(".animate-ping")).not.toBeNull();
    const { container: notLive } = render(<StatusChip kind="deal" status="delivered" />);
    expect(notLive.querySelector(".animate-ping")).toBeNull();
  });

  it("accepts a tone-only chip for derived states", () => {
    const { container } = render(<StatusChip tone="danger" label="Overdue 12d" />);
    expect(container.firstElementChild).toHaveClass("bg-brick-tint");
    expect(screen.getByText("Overdue 12d")).toBeInTheDocument();
  });

  it("renders a non-empty, styled chip for every status in every shared enum", () => {
    // Coverage sweep. The per-status *tones* are typed as Record<Union, Tone>,
    // so adding a status to @sponsee/shared is a compile error, not a silent
    // unstyled pill — this asserts nothing renders blank at runtime either.
    const cases = [
      ...dealStages.map((s) => ({ kind: "deal" as const, status: s })),
      ...invoiceStatuses.map((s) => ({ kind: "invoice" as const, status: s })),
      ...deliverableStatuses.map((s) => ({ kind: "deliverable" as const, status: s })),
      ...contractStatuses.map((s) => ({ kind: "contract" as const, status: s })),
    ];
    expect(cases).toHaveLength(20);

    for (const c of cases) {
      // @ts-expect-error -- the union is narrowed per-branch above; this loop erases it
      const { container, unmount } = render(<StatusChip kind={c.kind} status={c.status} />);
      const chip = container.firstElementChild!;
      expect(chip.textContent?.trim()).not.toBe("");
      expect(chip.className).toMatch(/rounded-full/);
      unmount();
    }
  });
});

describe("Sparkline", () => {
  it("draws a polyline through every point", () => {
    const { container } = render(<Sparkline points={[1, 5, 3, 9]} width={90} height={30} />);
    const path = container.querySelector("path")!;
    const d = path.getAttribute("d")!;
    expect(d.startsWith("M0.0,")).toBe(true);
    expect(d.match(/[ML]/g)).toHaveLength(4);
    expect(path).toHaveClass("stroke-pine");
  });

  it("renders nothing for a series too short to draw", () => {
    const { container } = render(<Sparkline points={[7]} />);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("survives a flat series without dividing by zero", () => {
    const { container } = render(<Sparkline points={[4, 4, 4]} />);
    expect(container.querySelector("path")!.getAttribute("d")).not.toContain("NaN");
  });
});

describe("StatCard", () => {
  it("shows the eyebrow, formatted value and context", () => {
    render(<StatCard eyebrow="Revenue" value={12400} currency context="6 deals" />);
    expect(screen.getByText("Revenue")).toBeInTheDocument();
    expect(screen.getByText("6 deals")).toBeInTheDocument();
    // The figure tweens up from 0, so assert the prefix rather than the endpoint.
    expect(screen.getByText(/^\$/)).toBeInTheDocument();
  });

  it("renders a delta chip with its tone", () => {
    const { container } = render(
      <StatCard eyebrow="Outstanding" value={800} delta={{ text: "+12%", tone: "accent" }} />
    );
    expect(container.querySelector(".bg-pine-tint")).toHaveTextContent("+12%");
  });

  it("is a real button only when it has an action", () => {
    const { container } = render(<StatCard eyebrow="Due this week" value={3} />);
    expect(container.querySelector("button")).toBeNull();

    const { container: clickable } = render(
      <StatCard eyebrow="Due this week" value={3} onClick={() => {}} />
    );
    expect(clickable.querySelector("button")).toHaveAttribute("type", "button");
  });
});
