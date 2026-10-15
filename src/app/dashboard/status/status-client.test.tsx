/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import StatusClient from "./status-client";
import type { ComponentHealth } from "@/lib/health-check";

describe("StatusClient component (#1333)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const healthyComponents: ComponentHealth[] = [
    { name: "PostgreSQL", status: "healthy", latencyMs: 12 },
    { name: "Redis", status: "healthy", latencyMs: 4 },
    { name: "Groq LLM", status: "healthy", latencyMs: 110 },
  ];

  it("renders healthy system state with operational message and components", () => {
    render(
      <StatusClient
        status="healthy"
        timestamp="2026-10-15T12:00:00Z"
        uptime={7200}
        components={healthyComponents}
      />,
    );

    expect(screen.getByText(/HEALTHY/i)).toBeDefined();
    expect(screen.getByText(/All systems operational/i)).toBeDefined();
    expect(screen.getByText("PostgreSQL")).toBeDefined();
    expect(screen.getByText("Redis")).toBeDefined();
    expect(screen.getByText("Groq LLM")).toBeDefined();
    expect(screen.getByText("12ms")).toBeDefined();
    expect(screen.getByText("4ms")).toBeDefined();
    expect(screen.getByText("110ms")).toBeDefined();
  });

  it("renders degraded service state and component warning messages", () => {
    const degradedComponents: ComponentHealth[] = [
      { name: "PostgreSQL", status: "healthy", latencyMs: 15 },
      {
        name: "Redis",
        status: "degraded",
        latencyMs: 350,
        message: "High memory fragmentation",
      },
      { name: "Groq LLM", status: "healthy", latencyMs: 95 },
    ];

    render(
      <StatusClient
        status="degraded"
        timestamp="2026-10-15T12:00:00Z"
        uptime={3600}
        components={degradedComponents}
      />,
    );

    expect(screen.getByText(/DEGRADED/i)).toBeDefined();
    expect(screen.getByText(/All systems partially operational/i)).toBeDefined();
    expect(screen.getByText("High memory fragmentation")).toBeDefined();
    expect(screen.getByText("350ms")).toBeDefined();
  });

  it("renders down system status when critical services fail", () => {
    const downComponents: ComponentHealth[] = [
      {
        name: "PostgreSQL",
        status: "down",
        latencyMs: 0,
        message: "Connection refused on port 5432",
      },
      { name: "Redis", status: "healthy", latencyMs: 5 },
    ];

    render(
      <StatusClient
        status="down"
        timestamp="2026-10-15T12:00:00Z"
        uptime={600}
        components={downComponents}
      />,
    );

    expect(screen.getByText(/DOWN/i)).toBeDefined();
    expect(screen.getByText(/All systems experiencing issues/i)).toBeDefined();
    expect(screen.getByText("Connection refused on port 5432")).toBeDefined();
  });

  it("refreshes status data on manual refresh button click", async () => {
    const updatedReport = {
      status: "healthy",
      timestamp: "2026-10-15T12:05:00Z",
      uptime: 7500,
      components: [
        { name: "PostgreSQL", status: "healthy", latencyMs: 8 },
        { name: "Redis", status: "healthy", latencyMs: 2 },
      ],
    };

    global.fetch = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue(updatedReport),
    });

    render(
      <StatusClient
        status="degraded"
        timestamp="2026-10-15T12:00:00Z"
        uptime={7200}
        components={healthyComponents}
      />,
    );

    const refreshButton = screen.getByRole("button", { name: /Refresh/i });
    fireEvent.click(refreshButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/health", { cache: "no-store" });
      expect(screen.getByText("8ms")).toBeDefined();
      expect(screen.getByText("2ms")).toBeDefined();
    });
  });
});
