// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { toast } from "sonner";
import Payments from "./Payments";

type AwaitingReviewItem = {
  event: {
    id: string;
    step: number;
    toEmail: string | null;
    subjectSnapshot: string;
    bodySnapshot: string;
  };
  invoice: { title: string; number: string };
  recipientEmail: string | null;
};

let awaitingReviewItem: AwaitingReviewItem = {
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

/** Options the page hands to useMutation, so tests can fire onError directly. */
let approveOptions: { onError?: (err: unknown) => void; onSuccess?: () => void } = {};
let editAndSendOptions: { onError?: (err: unknown) => void; onSuccess?: () => void } = {};

vi.mock("sonner", () => {
  const toast = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() });
  return { toast };
});

vi.mock("@/trpc", () => ({
  trpc: {
    useUtils: () => ({
      invoice: { list: { invalidate: vi.fn() } },
      chase: { awaitingReview: { invalidate: vi.fn() } },
    }),
    invoice: {
      list: {
        useQuery: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
      },
      markPaid: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
    chase: {
      awaitingReview: {
        useQuery: () => ({
          data: [awaitingReviewItem],
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
    },
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

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

describe("Payments awaiting-review recipient hint", () => {
  it("shows the missing-contact hint and disables Approve when recipientEmail is null even if toEmail is stale", () => {
    awaitingReviewItem = {
      event: {
        id: "e1",
        step: 1,
        toEmail: "stale@example.com",
        subjectSnapshot: "Quick reminder",
        bodySnapshot: "Please pay",
      },
      invoice: { title: "Q4 Campaign", number: "INV-1" },
      recipientEmail: null,
    };

    render(<Payments />);

    expect(screen.getByText(/No recipient email/)).toBeInTheDocument();
    expect(screen.queryByText(/stale@example\.com/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
  });

  it("renders the recipient and enables Approve when recipientEmail resolves but toEmail is null", () => {
    awaitingReviewItem = {
      event: {
        id: "e1",
        step: 1,
        toEmail: null,
        subjectSnapshot: "Quick reminder",
        bodySnapshot: "Please pay",
      },
      invoice: { title: "Q4 Campaign", number: "INV-1" },
      recipientEmail: "late@example.com",
    };

    render(<Payments />);

    expect(screen.getByText(/To:\s+late@example\.com/)).toBeInTheDocument();
    expect(screen.queryByText(/No recipient email/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
  });
});
