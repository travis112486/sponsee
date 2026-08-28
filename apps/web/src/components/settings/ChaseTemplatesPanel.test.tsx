// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import ChaseTemplatesPanel from "./ChaseTemplatesPanel";

const mockInvalidate = vi.fn();
const mockRefetch = vi.fn();
let mockQueryReturn: {
  data?: Array<{
    id: string;
    step: number;
    subject: string;
    body: string;
    enabled: boolean;
    offsetDays: number;
  }>;
  isLoading: boolean;
  isError: boolean;
  refetch: typeof mockRefetch;
} = { data: undefined, isLoading: false, isError: false, refetch: mockRefetch };

const mockUpdateReturn = { mutate: vi.fn(), isPending: false };

vi.mock("@/trpc", () => ({
  trpc: {
    useUtils: () => ({
      chase: {
        templates: {
          invalidate: mockInvalidate,
        },
      },
    }),
    chase: {
      templates: {
        useQuery: () => mockQueryReturn,
      },
      updateTemplate: {
        useMutation: () => mockUpdateReturn,
      },
    },
  },
}));

vi.mock("@sponsee/shared", () => ({
  renderMergeTokens: (template: string) => template,
  validateMergeTokens: () => [] as string[],
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function setQueryState(state: Partial<typeof mockQueryReturn>) {
  mockQueryReturn = { ...mockQueryReturn, ...state };
}

describe("ChaseTemplatesPanel", () => {
  it("shows loading spinner while fetching", () => {
    setQueryState({ isLoading: true, isError: false, data: undefined });
    const { container } = render(<ChaseTemplatesPanel />);
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("shows error state with retry button on query failure", () => {
    setQueryState({ isLoading: false, isError: true, data: undefined });
    render(<ChaseTemplatesPanel />);
    expect(screen.getByText("Couldn't load chase templates.")).toBeInTheDocument();
    const retryBtn = screen.getByRole("button", { name: /retry/i });
    expect(retryBtn).toBeInTheDocument();
    fireEvent.click(retryBtn);
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it("renders template list with preview and edit actions", () => {
    setQueryState({
      isLoading: false,
      isError: false,
      data: [
        {
          id: "t1",
          step: 1,
          subject: "Friendly reminder: {deal_title}",
          body: "Hi {brand_contact}, just a friendly reminder about invoice {invoice_id}.",
          enabled: true,
          offsetDays: 3,
        },
        {
          id: "t2",
          step: 2,
          subject: "Second notice: {deal_title}",
          body: "Hi {brand_contact}, following up on invoice {invoice_id}.",
          enabled: false,
          offsetDays: 7,
        },
      ],
    });
    render(<ChaseTemplatesPanel />);
    expect(screen.getByText("Friendly reminder")).toBeInTheDocument();
    expect(screen.getByText("Second notice")).toBeInTheDocument();
    expect(screen.getByText("Friendly reminder: {deal_title}")).toBeInTheDocument();
    expect(screen.getByText(/Sends 3 days after due date/)).toBeInTheDocument();
    expect(screen.getByText(/Sends 7 days after due date/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Preview/ }).length).toBe(2);
    expect(screen.getAllByRole("button", { name: /Edit/ }).length).toBe(2);
  });

  it("has accessible label-input pairs in edit mode", () => {
    setQueryState({
      isLoading: false,
      isError: false,
      data: [
        {
          id: "t1",
          step: 1,
          subject: "Subject",
          body: "Body",
          enabled: true,
          offsetDays: 3,
        },
      ],
    });
    render(<ChaseTemplatesPanel />);

    const editBtn = screen.getByRole("button", { name: "Edit" });
    fireEvent.click(editBtn);

    const subjectInput = screen.getByLabelText("Subject");
    expect(subjectInput).toBeInTheDocument();
    expect(subjectInput.tagName.toLowerCase()).toBe("input");

    const bodyInput = screen.getByLabelText("Body");
    expect(bodyInput).toBeInTheDocument();
    expect(bodyInput.tagName.toLowerCase()).toBe("textarea");
  });
});
