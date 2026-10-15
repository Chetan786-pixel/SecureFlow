/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import SettingsClient from "./settings-client";

const { toastSuccessMock, toastErrorMock, updateSlackWebhookMock } = vi.hoisted(() => ({
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
  updateSlackWebhookMock: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: toastSuccessMock,
    error: toastErrorMock,
  },
}));

vi.mock("@/lib/actions/settings", () => ({
  updateSlackWebhook: updateSlackWebhookMock,
}));

describe("SettingsClient component (#1333)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders with initial webhook URL", () => {
    render(<SettingsClient initialWebhookUrl="https://hooks.slack.com/services/initial" />);

    const input = screen.getByPlaceholderText(
      "https://hooks.slack.com/services/...",
    ) as HTMLInputElement;
    expect(input.value).toBe("https://hooks.slack.com/services/initial");
    expect(screen.getByRole("button", { name: /Save Settings/i })).toBeDefined();
  });

  it("renders with empty input when initialWebhookUrl is null", () => {
    render(<SettingsClient initialWebhookUrl={null} />);

    const input = screen.getByPlaceholderText(
      "https://hooks.slack.com/services/...",
    ) as HTMLInputElement;
    expect(input.value).toBe("");
  });

  it("updates form input state when user types", () => {
    render(<SettingsClient initialWebhookUrl="" />);

    const input = screen.getByPlaceholderText(
      "https://hooks.slack.com/services/...",
    ) as HTMLInputElement;
    fireEvent.change(input, {
      target: { value: "https://hooks.slack.com/services/T00/B00/XXXXX" },
    });

    expect(input.value).toBe("https://hooks.slack.com/services/T00/B00/XXXXX");
  });

  it("submits updated webhook URL and displays success toast", async () => {
    updateSlackWebhookMock.mockResolvedValueOnce({ success: true });

    render(<SettingsClient initialWebhookUrl="" />);

    const input = screen.getByPlaceholderText("https://hooks.slack.com/services/...");
    fireEvent.change(input, {
      target: { value: "https://hooks.slack.com/services/new-url" },
    });

    const saveButton = screen.getByRole("button", { name: /Save Settings/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(updateSlackWebhookMock).toHaveBeenCalledWith(
        "https://hooks.slack.com/services/new-url",
      );
      expect(toastSuccessMock).toHaveBeenCalledWith("Settings saved successfully.");
    });
  });

  it("displays error toast when update action fails", async () => {
    updateSlackWebhookMock.mockRejectedValueOnce(new Error("Invalid webhook URL format"));

    render(<SettingsClient initialWebhookUrl="https://hooks.slack.com/services/old" />);

    const saveButton = screen.getByRole("button", { name: /Save Settings/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(updateSlackWebhookMock).toHaveBeenCalledWith("https://hooks.slack.com/services/old");
      expect(toastErrorMock).toHaveBeenCalledWith("Invalid webhook URL format");
    });
  });
});
