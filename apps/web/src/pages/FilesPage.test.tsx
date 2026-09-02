// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import FilesPage from "./FilesPage";
import { formatBytes, fileTypeLabel } from "@/lib/file-format";

const deleteMutate = vi.fn();
const fileUrlMutateAsync = vi.fn();

type FileFixture = {
  id: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  originalFilename: string | null;
  originDealId: string | null;
  originDealTitle: string | null;
  originDealDeletedAt: string | null;
  scope: "evidence" | "contract";
  createdAt: string;
};

const liveFile: FileFixture = {
  id: "f1",
  storageKey: "creators/c1/deals/d1/proofs/a.png",
  mimeType: "image/png",
  sizeBytes: 2_500_000,
  originalFilename: "screenshot.png",
  originDealId: "d1",
  originDealTitle: "Acme Q3",
  originDealDeletedAt: null,
  scope: "evidence",
  createdAt: "2026-08-01T00:00:00.000Z",
};

const deletedDealFile: FileFixture = {
  id: "f2",
  storageKey: "creators/c1/deals/d1/contracts/b.pdf",
  mimeType: "application/pdf",
  sizeBytes: 1_000_000,
  originalFilename: "contract.pdf",
  originDealId: null,
  originDealTitle: "Acme Q3",
  originDealDeletedAt: null,
  scope: "contract",
  createdAt: "2026-07-15T00:00:00.000Z",
};

let usageFixture = { usedBytes: 4_000_000_000, capBytes: 5 * 1024 ** 3, planTier: "starter" as const };
let filesFixture: FileFixture[] = [];

vi.mock("@/trpc", () => ({
  trpc: {
    useUtils: () => ({
      storage: { list: { invalidate: vi.fn() }, usage: { invalidate: vi.fn() } },
    }),
    storage: {
      usage: {
        useQuery: () => ({ data: usageFixture, isLoading: false, isError: false, refetch: vi.fn() }),
      },
      list: {
        useQuery: () => ({ data: { files: filesFixture }, isLoading: false, isError: false, refetch: vi.fn() }),
      },
      fileUrl: {
        useMutation: () => ({
          mutateAsync: fileUrlMutateAsync,
          mutate: vi.fn(),
          isPending: false,
          reset: vi.fn(),
        }),
      },
      deleteFile: {
        useMutation: () => ({ mutate: deleteMutate, isPending: false }),
      },
    },
  },
}));

beforeEach(() => {
  usageFixture = { usedBytes: 4_000_000_000, capBytes: 5 * 1024 ** 3, planTier: "starter" };
  filesFixture = [liveFile, deletedDealFile];
  deleteMutate.mockReset();
  fileUrlMutateAsync.mockReset();
  fileUrlMutateAsync.mockResolvedValue({ url: "https://example.com/preview" });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderFiles() {
  return render(
    <MemoryRouter initialEntries={["/files"]}>
      <FilesPage />
    </MemoryRouter>
  );
}

describe("formatBytes", () => {
  it("formats bytes into binary units", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(2_500_000)).toBe("2.4 MB");
    expect(formatBytes(4 * 1024 ** 3)).toBe("4 GB");
  });
});

describe("fileTypeLabel", () => {
  it("labels PDFs, images, and unknown types", () => {
    expect(fileTypeLabel("application/pdf")).toBe("PDF");
    expect(fileTypeLabel("image/png")).toBe("PNG");
    expect(fileTypeLabel("image/jpeg")).toBe("JPEG");
    expect(fileTypeLabel("text/plain")).toBe("text/plain");
    expect(fileTypeLabel("")).toBe("File");
  });
});

describe("FilesPage", () => {
  it("shows the usage meter with plan name and cap", () => {
    renderFiles();
    expect(screen.getByText("Starter plan")).toBeInTheDocument();
    expect(screen.getByText(/of 5 GB/)).toBeInTheDocument();
  });

  it("mentions the next tier once usage crosses 80%", () => {
    usageFixture = { usedBytes: 4_500_000_000, capBytes: 5 * 1024 ** 3, planTier: "starter" };
    renderFiles();
    expect(screen.getByText(/Creator plan raises your cap to 25 GB/)).toBeInTheDocument();
  });

  it("renders each file with size, type, and deal", () => {
    renderFiles();
    expect(screen.getByText("screenshot.png")).toBeInTheDocument();
    expect(screen.getByText("contract.pdf")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Acme Q3" })).toBeInTheDocument();
  });

  it("marks a file whose deal was deleted", () => {
    renderFiles();
    expect(screen.getByText(/\(deal deleted\)/)).toBeInTheDocument();
  });

  it("links a live-deal file to its deal", () => {
    renderFiles();
    const link = screen.getByRole("link", { name: "Acme Q3" });
    expect(link).toHaveAttribute("href", "/pipeline/d1");
  });

  it("shows a non-error empty state when there are no files", () => {
    filesFixture = [];
    renderFiles();
    expect(screen.getByText("No files yet")).toBeInTheDocument();
  });

  it("opens a preview that resolves a signed URL for the file", async () => {
    renderFiles();
    fireEvent.click(screen.getByRole("button", { name: "Preview screenshot.png" }));
    await waitFor(() => expect(fileUrlMutateAsync).toHaveBeenCalledWith({ storageKey: liveFile.storageKey }));
    expect(await screen.findByRole("img")).toHaveAttribute("src", "https://example.com/preview");
  });

  it("names the file in the delete confirmation", () => {
    renderFiles();
    fireEvent.click(screen.getByRole("button", { name: "Delete screenshot.png" }));
    expect(screen.getByText(/permanently deletes/)).toBeInTheDocument();
    expect(screen.getByText("Delete file?")).toBeInTheDocument();
  });

  it("warns when deleting a file still attached to a live deal", () => {
    renderFiles();
    fireEvent.click(screen.getByRole("button", { name: "Delete screenshot.png" }));
    expect(screen.getByText(/still attached to/)).toBeInTheDocument();
  });

  it("deletes a deleted-deal file without the live-deal warning", () => {
    renderFiles();
    fireEvent.click(screen.getByRole("button", { name: "Delete contract.pdf" }));
    expect(screen.queryByText(/still attached to/)).not.toBeInTheDocument();
  });

  it("calls the delete mutation on confirm", () => {
    renderFiles();
    fireEvent.click(screen.getByRole("button", { name: "Delete screenshot.png" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete file" }));
    expect(deleteMutate).toHaveBeenCalledWith({ storageKey: liveFile.storageKey });
  });
});
