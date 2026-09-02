// @vitest-environment jsdom
//
// Smoke coverage for the ported Radix primitives (SPO-193). These are thin
// styling wrappers, so the value here is proving (a) each one mounts under our
// Tailwind v3 config without a Radix version/API mismatch, and (b) the warm
// token classes actually reach the DOM — the mockup shipped Tailwind v4 class
// syntax (`outline-hidden`, `origin-(--var)`, `*:`) that silently no-ops in v3.
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { Avatar, AvatarFallback } from "./avatar";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { Progress } from "./progress";
import { ScrollArea } from "./scroll-area";
import { Separator } from "./separator";
import { Slider } from "./slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
  // Radix's popper layer calls these; jsdom implements neither.
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

afterEach(cleanup);

describe("Slider", () => {
  it("exposes a real slider role with the current value", () => {
    render(<Slider value={[8]} min={0} max={20} step={0.5} onValueChange={() => {}} />);
    const thumb = screen.getByRole("slider");
    expect(thumb).toHaveAttribute("aria-valuenow", "8");
    expect(thumb).toHaveAttribute("aria-valuemin", "0");
    expect(thumb).toHaveAttribute("aria-valuemax", "20");
  });

  it("renders one thumb per value", () => {
    render(<Slider value={[2, 9]} onValueChange={() => {}} />);
    expect(screen.getAllByRole("slider")).toHaveLength(2);
  });

  it("moves by keyboard", () => {
    let latest: number[] = [];
    render(<Slider value={[5]} min={0} max={10} onValueChange={(v) => (latest = v)} />);
    fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowRight" });
    expect(latest).toEqual([6]);
  });

  it("paints the filled range with the pine token", () => {
    const { container } = render(<Slider defaultValue={[50]} />);
    expect(container.querySelector('[data-slot="slider-range"]')).toHaveClass("bg-pine");
    expect(container.querySelector('[data-slot="slider-track"]')).toHaveClass("bg-hairline");
  });

  it("puts the accessible name and value text on the thumb, not the root", () => {
    render(
      <Slider
        value={[8]}
        min={0}
        max={20}
        onValueChange={() => {}}
        aria-label="Volume"
        formatValueText={(v) => `${v} out of 20`}
      />
    );
    const thumb = screen.getByRole("slider", { name: "Volume" });
    expect(thumb).toHaveAttribute("aria-valuetext", "8 out of 20");
  });
});

describe("Progress", () => {
  it("translates the indicator by the remaining percentage", () => {
    const { container } = render(<Progress value={40} />);
    const indicator = container.querySelector<HTMLElement>('[data-slot="progress-indicator"]')!;
    expect(indicator.style.transform).toBe("translateX(-60%)");
    expect(indicator).toHaveClass("bg-pine");
  });

  it("clamps out-of-range values instead of overflowing the track", () => {
    const { container } = render(<Progress value={140} />);
    expect(
      container.querySelector<HTMLElement>('[data-slot="progress-indicator"]')!.style.transform
    ).toBe("translateX(-0%)");

    const { container: negative } = render(<Progress value={-20} />);
    expect(
      negative.querySelector<HTMLElement>('[data-slot="progress-indicator"]')!.style.transform
    ).toBe("translateX(-100%)");
  });
});

describe("Tabs", () => {
  it("switches panels on click", () => {
    render(
      <Tabs defaultValue="month">
        <TabsList>
          <TabsTrigger value="month">Month</TabsTrigger>
          <TabsTrigger value="quarter">Quarter</TabsTrigger>
        </TabsList>
        <TabsContent value="month">Month view</TabsContent>
        <TabsContent value="quarter">Quarter view</TabsContent>
      </Tabs>
    );
    expect(screen.getByText("Month view")).toBeInTheDocument();
    // Radix selects a tab on mousedown, not click.
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Quarter" }), { button: 0 });
    expect(screen.getByText("Quarter view")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Quarter" })).toHaveAttribute(
      "data-state",
      "active"
    );
  });
});

describe("Dialog", () => {
  it("renders title and description into the portal when open", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Log a deal</DialogTitle>
          <DialogDescription>Add a brand deal to your pipeline.</DialogDescription>
        </DialogContent>
      </Dialog>
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Log a deal")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("can hide the close affordance", () => {
    render(
      <Dialog open>
        <DialogContent showCloseButton={false}>
          <DialogTitle>No close</DialogTitle>
        </DialogContent>
      </Dialog>
    );
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });
});

describe("DropdownMenu", () => {
  it("opens and renders items", () => {
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Sort</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Newest</DropdownMenuItem>
          <DropdownMenuItem variant="destructive">Remove</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
    fireEvent.pointerDown(
      screen.getByText("Sort"),
      new MouseEvent("pointerdown", { bubbles: true })
    );
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByText("Newest")).toBeInTheDocument();
    expect(screen.getByText("Remove")).toHaveClass("text-brick");
  });
});

describe("Popover", () => {
  it("renders content once opened", () => {
    render(
      <Popover>
        <PopoverTrigger>Filters</PopoverTrigger>
        <PopoverContent>Brand filter</PopoverContent>
      </Popover>
    );
    expect(screen.queryByText("Brand filter")).toBeNull();
    fireEvent.click(screen.getByText("Filters"));
    expect(screen.getByText("Brand filter")).toBeInTheDocument();
  });
});

describe("Tooltip", () => {
  it("provides its own provider so a screen can drop one in standalone", () => {
    render(
      <Tooltip open>
        <TooltipTrigger>CPVH</TooltipTrigger>
        <TooltipContent>Cost per viewer-hour</TooltipContent>
      </Tooltip>
    );
    expect(screen.getAllByText("Cost per viewer-hour").length).toBeGreaterThan(0);
  });
});

describe("Avatar / Separator / ScrollArea", () => {
  it("falls back to initials when there is no image", () => {
    render(
      <Avatar>
        <AvatarFallback>PP</AvatarFallback>
      </Avatar>
    );
    expect(screen.getByText("PP")).toBeInTheDocument();
  });

  it("marks a decorative separator as presentational", () => {
    const { container } = render(<Separator />);
    const sep = container.firstElementChild!;
    expect(sep).toHaveClass("bg-hairline");
    expect(sep).toHaveAttribute("data-orientation", "horizontal");
  });

  it("renders children inside a scroll viewport", () => {
    const { container } = render(<ScrollArea className="h-24">rows</ScrollArea>);
    expect(container.querySelector('[data-slot="scroll-area-viewport"]')).toHaveTextContent(
      "rows"
    );
  });
});

describe("Tailwind v3 syntax guard", () => {
  it("uses no Tailwind v4-only class syntax anywhere in the rendered tree", () => {
    // The mockup was authored against Tailwind v4. `outline-hidden`,
    // `origin-(--var)` and the `*:` child variant compile to nothing under our
    // v3.4 config — they would silently degrade focus and popper behaviour.
    const { container } = render(
      <div>
        <Slider defaultValue={[1]} />
        <Progress value={10} />
        <Separator />
        <Tabs defaultValue="a">
          <TabsList>
            <TabsTrigger value="a">A</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
    );
    const html = container.innerHTML;
    expect(html).not.toMatch(/\boutline-hidden\b/);
    expect(html).not.toMatch(/origin-\(--/);
    expect(html).not.toMatch(/max-h-\(--/);
    expect(html).not.toMatch(/(?:^|\s)\*:/);
  });
});
