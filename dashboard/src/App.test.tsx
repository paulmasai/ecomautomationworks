import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App, nairobiScheduleToIso } from "./App";

describe("dashboard shell", () => {
  it("converts schedule input from Africa/Nairobi to UTC", () => {
    expect(nairobiScheduleToIso("2026-08-27T09:30")).toBe("2026-08-27T06:30:00.000Z");
    expect(nairobiScheduleToIso("")).toBeNull();
  });

  it("shows the staff login when no local preview was requested", async () => {
    window.history.replaceState({}, "", "/");
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Sign in to the console" })).toBeInTheDocument();
  });

  it("shows operational priorities in local preview mode", () => {
    window.history.replaceState({}, "", "/?demo=1");
    render(<App />);
    expect(screen.getByText("Outbound automation is safely paused")).toBeInTheDocument();
    expect(screen.getByText("Awaiting approval")).toBeInTheDocument();
    expect(screen.getAllByText("Human handoffs")).toHaveLength(2);
  });
});
