// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { toast } from "sonner";
import Payments from "./Payments";

const awaitingReviewItem = {
  event: {
    id: "e1",
    step: 1,
    toEmail: "brand@example.com",
    subjectSnapshot: "Quick reminder",
    bodySnapshot: "Please pay",
  },
  invoice: { title: "Q4 Campaign", number: "INV-1" },
  recipientEmail: "brand@example.com",
};

const openInvoice = {
  id: "inv-1",
  number: 1,
  title: "Q4 Campaign",
  status: "open",
  amountCents: 500000,
  currency: "USD",
  dueAt: null,
  issuedAt: new Date("2026-01-01T00:00:00Z").toISOString(),
};

function delivery(overrides: Record<string, unknown> = {}) {
  return {
    invoiceId: "inv-1",
    attempt: 1,
    status: "sent",
    toEmail: "brand-contact@example.com",
    sentAt: new Date("2026-01-02T00:00:00Z").toISOString(),
    deliveredAt: null,
    openedAt: null,
    bouncedAt: null,
    ...overrides,
  };
}

/** Options the page hands to useMutation, so tests can fire onError/onSuccess directly. */
let approveOptions: { onError?: (err: unknown) => void; onSuccess?: () => void } = {};
let editAndSendOptions: { onError?: (err: unknown) => void; onSuccess?: () => void } = {};
let sendOptions: { onError?: (err: unknown) => void; onSuccess?: () => void } = {};
const sendMutate = vi.fn();
const pauseMutate = vi.fn();
const resumeMutate = vi.fn();

let invoicesData: unknown[] = [];
let deliveriesData: unknown[] = [];
let deliveriesIsError = false;
let awaitingReviewData: unknown[] = [];
let chaseStateByInvoice: Record<string, unknown> = {};
let chaseEventsByInvoice: Record<string, unknown[]> = {};

vi.mock("sonner", () => {
  const toast = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() });
  return { toast };
});

vi.mock("@/trpc", () => ({
  trpc: {
    useUtils: () => ({
      invoice: { list: { invalidate: vi.fn() }, latestDeliveries: { invalidate: vi.fn() } },
      chase: { awaitingReview: { invalidate: vi.fn() }, state: { invalidate: vi.fn() } },
    }),
    invoice: {
      list: {
        useQuery: () => ({
          data: invoicesData,
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        }),
      },
      latestDeliveries: {
        useQuery: () => ({ data: deliveriesData, isError: deliveriesIsError }),
      },
      markPaid: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
      send: {
        useMutation: (opts: { onError?: (err: unknown) => void; onSuccess?: () => void }) => {
          sendOptions = opts;
          return { mutate: sendMutate, isPending: false };
        },
      },
    },
    chase: {
      awaitingReview: {
        useQuery: () => ({
          data: awaitingReviewData,
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        }),
      },
      approve: {
        useMutation: (opts: { onError?: (err: unknown) => void; onSuccess?: () => void }) => {
          approveOptions = opts;
          return { mutate: vi.fn(), isPending: false };
        },
      },
      editAndSend: {
        useMutation: (opts: { onError?: (err: unknown) => void; onSuccess?: () => void }) => {
          editAndSendOptions = opts;
          return { mutate: vi.fn(), isPending: false };
        },
      },
      state: {
        useQuery: ({ invoiceId }: { invoiceId: string }) => ({
          data: chaseStateByInvoice[invoiceId] ?? null,
        }),
      },
      events: {
        useQuery: ({ invoiceId }: { invoiceId: string }) => ({
          data: chaseEventsByInvoice[invoiceId] ?? [],
        }),
      },
      pause: {
        useMutation: () => ({ mutate: pauseMutate, isPending: false }),
      },
      resume: {
        useMutation: () => ({ mutate: resumeMutate, isPending: false }),
      },
    },
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  invoicesData = [];
  deliveriesData = [];
  deliveriesIsError = false;
  awaitingReviewData = [awaitingReviewItem];
  chaseStateByInvoice = {};
  chaseEventsByInvoice = {};
});

// Seed the defaults the first run needs too (afterEach only runs after a test).
invoicesData = [];
deliveriesData = [];
awaitingReviewData = [awaitingReviewItem];

describe("Payments chase approve/editAndSend error handling", () => {
  it("toasts the server message when approve fails", () => {
    render(<Payments />);
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();

    approveOptions.onError?.({
      message: "An approval for this chase email is still being queued. Please retry.",
    });

    expect(toast.error).toHaveBeenCalledWith(
      "An approval for this chase email is still being queued. Please retry."
    );
  });

  it("toasts the server message when editAndSend fails", () => {
    render(<Payments />);

    editAndSendOptions.onError?.({
      message: "Failed to queue chase email. Please retry.",
    });

    expect(toast.error).toHaveBeenCalledWith("Failed to queue chase email. Please retry.");
  });

  it("falls back to a retry prompt when the error carries no message", () => {
    render(<Payments />);

    approveOptions.onError?.({});

    expect(toast.error).toHaveBeenCalledWith(
      "Failed to send chase email. Please try again."
    );
  });
});

describe("Payments send/resend", () => {
  it("shows 'Send invoice' and sends after confirmation when no delivery exists yet", () => {
    invoicesData = [openInvoice];
    deliveriesData = [];
    vi.stubGlobal("confirm", vi.fn(() => true));

    render(<Payments />);

    const sendButton = screen.getByRole("button", { name: /send invoice/i });
    fireEvent.click(sendButton);

    expect(confirm).toHaveBeenCalled();
    expect(sendMutate).toHaveBeenCalledWith({ id: "inv-1" });
  });

  it("does not send when the confirmation is declined", () => {
    invoicesData = [openInvoice];
    deliveriesData = [];
    vi.stubGlobal("confirm", vi.fn(() => false));

    render(<Payments />);

    fireEvent.click(screen.getByRole("button", { name: /send invoice/i }));

    expect(sendMutate).not.toHaveBeenCalled();
  });

  it("shows 'Resend' once a delivery exists, and confirms against the delivery's recipient", () => {
    invoicesData = [openInvoice];
    deliveriesData = [delivery()];
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmSpy);

    render(<Payments />);

    expect(screen.queryByRole("button", { name: /^send invoice$/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /resend/i }));

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("brand-contact@example.com"));
    expect(sendMutate).toHaveBeenCalledWith({ id: "inv-1" });
  });

  it("surfaces the exact SPO-363 refusal message instead of a generic toast", () => {
    invoicesData = [openInvoice];
    deliveriesData = [];
    render(<Payments />);

    sendOptions.onError?.({
      message:
        "Add an email for this invoice's contact (or the deal's primary contact) before sending.",
    });

    expect(toast.error).toHaveBeenCalledWith(
      "Add an email for this invoice's contact (or the deal's primary contact) before sending."
    );
    expect(toast.error).not.toHaveBeenCalledWith("Something went wrong.");
  });

  it("falls back to actionable copy (not a generic toast) when the error carries no message", () => {
    invoicesData = [openInvoice];
    deliveriesData = [];
    render(<Payments />);

    sendOptions.onError?.({});

    expect(toast.error).toHaveBeenCalledWith("Couldn't send this invoice. Please try again.");
  });
});

describe("Payments delivery status chip", () => {
  it.each([
    ["queued", delivery({ status: "queued", sentAt: null }), "Sending"],
    ["sent", delivery({ status: "sent" }), "Sent"],
    ["delivered", delivery({ status: "delivered", deliveredAt: "2026-01-02T00:00:00Z" }), "Delivered"],
    [
      "opened",
      delivery({ status: "delivered", deliveredAt: "2026-01-02T00:00:00Z", openedAt: "2026-01-03T00:00:00Z" }),
      "Opened",
    ],
    ["failed", delivery({ status: "failed" }), "Send failed"],
  ])("renders the %s state", (_name, deliveryRow, expectedLabel) => {
    invoicesData = [openInvoice];
    deliveriesData = [deliveryRow];

    render(<Payments />);

    expect(screen.getByText(expectedLabel)).toBeInTheDocument();
  });

  it("renders bounced as a loud state with the reason visible in the DOM (not hover-only)", () => {
    invoicesData = [openInvoice];
    deliveriesData = [
      delivery({ status: "bounced", bouncedAt: "2026-01-02T00:00:00Z", toEmail: "bad@example.com" }),
    ];

    render(<Payments />);

    expect(screen.getByText("Bounced")).toBeInTheDocument();
    const reason = screen.getByText(/undelivered to bad@example\.com/i);
    expect(reason).toBeVisible();
    // Visible as static text, not gated behind a title/hover-only attribute.
    expect(reason.closest("[title]")).toBeNull();
  });
});

describe("Payments chase gating on delivery", () => {
  // The bug this epic exists to fix: an invoice that was never sent still
  // offered a working Resume, so the creator could arm reminders chasing an
  // email the brand never received.
  it("disables Resume when the invoice has never been sent, and says so in static text", () => {
    invoicesData = [openInvoice];
    deliveriesData = []; // no send attempt has ever been made
    chaseStateByInvoice = { "inv-1": { mode: "paused", pausedReason: "manual" } };

    render(<Payments />);
    fireEvent.click(screen.getByRole("button", { name: /more/i }));

    const resumeButton = screen.getByRole("button", { name: /resume/i });
    expect(resumeButton).toBeDisabled();

    const reason = screen.getByText(/has not been sent to the brand yet/i);
    expect(reason).toBeVisible();
    expect(reason.closest("[title]")).toBeNull();

    fireEvent.click(resumeButton);
    expect(resumeMutate).not.toHaveBeenCalled();
  });

  it("disables Resume while the send is still queued", () => {
    invoicesData = [openInvoice];
    deliveriesData = [delivery({ status: "queued", sentAt: null })];
    chaseStateByInvoice = { "inv-1": { mode: "paused", pausedReason: "manual" } };

    render(<Payments />);
    fireEvent.click(screen.getByRole("button", { name: /more/i }));

    expect(screen.getByRole("button", { name: /resume/i })).toBeDisabled();
    expect(screen.getByText(/has not left the queue yet/i)).toBeVisible();
  });

  // An armed chase on a never-sent invoice is the state the creator most
  // needs told about, and there is no Resume button rendered to hang the
  // explanation off — so the line must stand on its own.
  it("shows the lock reason on a never-sent invoice even while the chase is armed", () => {
    invoicesData = [openInvoice];
    deliveriesData = [];
    chaseStateByInvoice = { "inv-1": { mode: "armed", pausedReason: null } };

    render(<Payments />);
    fireEvent.click(screen.getByRole("button", { name: /more/i }));

    expect(screen.queryByRole("button", { name: /resume/i })).not.toBeInTheDocument();
    expect(screen.getByText(/has not been sent to the brand yet/i)).toBeVisible();
  });

  it("still lets the creator Pause a chase on a never-sent invoice", () => {
    invoicesData = [openInvoice];
    deliveriesData = [];
    chaseStateByInvoice = { "inv-1": { mode: "armed", pausedReason: null } };

    render(<Payments />);
    fireEvent.click(screen.getByRole("button", { name: /more/i }));

    const pauseButton = screen.getByRole("button", { name: /pause/i });
    expect(pauseButton).not.toBeDisabled();

    fireEvent.click(pauseButton);
    expect(pauseMutate).toHaveBeenCalledWith({ invoiceId: "inv-1", reason: "Manual pause" });
  });

  it("never disables Pause, even before the invoice is delivered — pausing only de-escalates", () => {
    invoicesData = [openInvoice];
    deliveriesData = [delivery({ status: "sent" })]; // sent, not yet delivered
    chaseStateByInvoice = { "inv-1": { mode: "armed", pausedReason: null } };

    render(<Payments />);
    fireEvent.click(screen.getByRole("button", { name: /more/i }));

    const pauseButton = screen.getByRole("button", { name: /pause/i });
    expect(pauseButton).not.toBeDisabled();

    fireEvent.click(pauseButton);
    expect(pauseMutate).toHaveBeenCalledWith({ invoiceId: "inv-1", reason: "Manual pause" });
  });

  it("disables Resume and shows the bounce-specific reason when the invoice bounced", () => {
    invoicesData = [openInvoice];
    deliveriesData = [delivery({ status: "bounced", bouncedAt: "2026-01-02T00:00:00Z" })];
    chaseStateByInvoice = { "inv-1": { mode: "paused", pausedReason: "hard_bounce" } };

    render(<Payments />);
    fireEvent.click(screen.getByRole("button", { name: /more/i }));

    const resumeButton = screen.getByRole("button", { name: /resume/i });
    expect(resumeButton).toBeDisabled();
    expect(screen.getByText(/email bounced, so reminders would go nowhere/i)).toBeVisible();

    fireEvent.click(resumeButton);
    expect(resumeMutate).not.toHaveBeenCalled();
  });

  it("disables Resume and shows the send-failed reason when the last send failed", () => {
    invoicesData = [openInvoice];
    deliveriesData = [delivery({ status: "failed" })];
    chaseStateByInvoice = { "inv-1": { mode: "paused", pausedReason: "manual" } };

    render(<Payments />);
    fireEvent.click(screen.getByRole("button", { name: /more/i }));

    expect(screen.getByRole("button", { name: /resume/i })).toBeDisabled();
    expect(
      screen.getByText(/last send failed before it reached the brand, so reminders would go nowhere/i)
    ).toBeVisible();
  });

  it("enables Resume once delivery is merely sent (not bounced or failed), with no lock message", () => {
    invoicesData = [openInvoice];
    deliveriesData = [delivery({ status: "sent" })];
    chaseStateByInvoice = { "inv-1": { mode: "paused", pausedReason: "manual" } };

    render(<Payments />);
    fireEvent.click(screen.getByRole("button", { name: /more/i }));

    const resumeButton = screen.getByRole("button", { name: /resume/i });
    expect(resumeButton).not.toBeDisabled();
    expect(screen.queryByText(/reminders would go nowhere/i)).not.toBeInTheDocument();

    fireEvent.click(resumeButton);
    expect(resumeMutate).toHaveBeenCalledWith({ invoiceId: "inv-1" });
  });

  it("also unlocks Resume once the invoice has been opened", () => {
    invoicesData = [openInvoice];
    deliveriesData = [
      delivery({
        status: "delivered",
        deliveredAt: "2026-01-02T00:00:00Z",
        openedAt: "2026-01-03T00:00:00Z",
      }),
    ];
    chaseStateByInvoice = { "inv-1": { mode: "paused", pausedReason: "manual" } };

    render(<Payments />);
    fireEvent.click(screen.getByRole("button", { name: /more/i }));

    expect(screen.getByRole("button", { name: /resume/i })).not.toBeDisabled();
  });

  it("suppresses the lock message when the deliveries query errored, even with a stale bounced row cached", () => {
    invoicesData = [openInvoice];
    // Stale cached data from before a refetch failure — deliveriesIsError
    // means we don't know the current state, so we must not act on it.
    deliveriesData = [delivery({ status: "bounced", bouncedAt: "2026-01-02T00:00:00Z" })];
    deliveriesIsError = true;
    chaseStateByInvoice = { "inv-1": { mode: "paused", pausedReason: "hard_bounce" } };

    render(<Payments />);
    fireEvent.click(screen.getByRole("button", { name: /more/i }));

    expect(screen.getByRole("button", { name: /resume/i })).not.toBeDisabled();
    expect(screen.queryByText(/reminders would go nowhere/i)).not.toBeInTheDocument();
  });
});

describe("Payments delivery-status query failure", () => {
  it("shows an inline notice without breaking the rest of the page", () => {
    invoicesData = [openInvoice];
    deliveriesData = [];
    deliveriesIsError = true;

    render(<Payments />);

    expect(screen.getByText(/couldn't load delivery status/i)).toBeInTheDocument();
    // Send still works even though delivery status failed to load.
    expect(screen.getByRole("button", { name: /send invoice/i })).toBeInTheDocument();
  });
});
