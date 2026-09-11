import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrivacyRequests } from "./PrivacyRequests";
import * as api from "./lib/api";

afterEach(() => vi.restoreAllMocks());

describe("privacy request review", () => {
  it("does not load sensitive requests before MFA", () => {
    const request = vi.spyOn(api, "apiRequest");
    render(<PrivacyRequests demo={false} hasMfa={false} />);
    expect(screen.getByText("Complete MFA in Settings to access privacy requests.")).toBeInTheDocument();
    expect(request).not.toHaveBeenCalled();
  });

  it("requires deliberate confirmation and sends only verified identifiers", async () => {
    const request = vi.spyOn(api, "apiRequest")
      .mockResolvedValueOnce({ items: [{ id: "request-1", source: "meta", contact: null, reference: null, meta_user_id: "111111", meta_app_id: "app-1", created_at: "2026-09-10T00:00:00Z" }] })
      .mockResolvedValueOnce({ status: "completed" })
      .mockResolvedValueOnce({ items: [] });
    render(<PrivacyRequests demo={false} hasMfa />);
    fireEvent.click(await screen.findByRole("button", { name: "Review request" }));
    const identifiers = screen.getByLabelText("Verified customer identifiers");
    expect(identifiers).toHaveValue("");
    const button = screen.getByRole("button", { name: "Delete verified data" });
    expect(button).toBeDisabled();
    fireEvent.change(identifiers, { target: { value: "222222\n333333" } });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Type DELETE VERIFIED DATA to confirm"), { target: { value: "DELETE VERIFIED DATA" } });
    fireEvent.click(button);
    await waitFor(() => expect(request).toHaveBeenCalledWith("/privacy/requests/request-1/complete", {
      method: "POST", body: JSON.stringify({ subjectIds: ["222222", "333333"], verification: "existing_channel", confirmation: "DELETE VERIFIED DATA" }),
    }));
    expect(await screen.findByText("Verified application records deleted. The private status page now shows completion.")).toBeInTheDocument();
    expect(screen.queryByText(/app-scoped user 111111/)).not.toBeInTheDocument();
  });
});
