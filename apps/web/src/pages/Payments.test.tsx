// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
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
