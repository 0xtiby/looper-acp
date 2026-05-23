import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agents, config, init } from "./cli.js";
import type { AcpRegistry } from "./registry.js";

describe("init", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "looper-acp-cli-init-"));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("creates config and fetches registry", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((msg: unknown) =>
      logs.push(String(msg)),
    );

    const writeDefaultConfig = vi
      .fn()
      .mockResolvedValue(path.join(workDir, ".looper-acp", "config.json"));
    const fetchAndCacheRegistry = vi.fn().mockResolvedValue({
      agents: [{ id: "test-agent" }],
    } as unknown as AcpRegistry);

    await init({ cwd: workDir }, { writeDefaultConfig, fetchAndCacheRegistry });

    expect(writeDefaultConfig).toHaveBeenCalledWith(workDir);
    expect(fetchAndCacheRegistry).toHaveBeenCalled();
    expect(logs.some((l) => l.includes("Created"))).toBe(true);
    expect(logs.some((l) => l.includes("Fetched 1 agents"))).toBe(true);
  });

  it("exits with error when config already exists", async () => {
    const errors: string[] = [];
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });
    vi.spyOn(console, "error").mockImplementation((msg: unknown) =>
      errors.push(String(msg)),
    );

    const writeDefaultConfig = vi
      .fn()
      .mockRejectedValue(new Error("Config file already exists at /some/path"));
    const fetchAndCacheRegistry = vi.fn();

    await expect(
      init({ cwd: workDir }, { writeDefaultConfig, fetchAndCacheRegistry }),
    ).rejects.toThrow("exit");

    expect(writeDefaultConfig).toHaveBeenCalledWith(workDir);
    expect(fetchAndCacheRegistry).not.toHaveBeenCalled();
    expect(errors.some((e) => /exists/i.test(e))).toBe(true);
    exitSpy.mockRestore();
  });
});

describe("config", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "looper-acp-cli-config-"));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("prints resolved defaults when no config file exists", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((msg: unknown) =>
      logs.push(String(msg)),
    );

    await config({ cwd: workDir });

    expect(logs).toHaveLength(1);
    const parsed = JSON.parse(logs[0] ?? "");
    expect(parsed.maxIterations).toBe(10);
    expect(parsed.sentinel).toBe(":::LOOPER_DONE:::");
    expect(parsed.vars).toEqual({});
    expect(parsed.debug).toBe(false);
  });

  it("merges file config with defaults and prints it", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((msg: unknown) =>
      logs.push(String(msg)),
    );

    await mkdir(path.join(workDir, ".looper-acp"), { recursive: true });
    await writeFile(
      path.join(workDir, ".looper-acp", "config.json"),
      JSON.stringify({ agent: "claude-acp", maxIterations: 5 }),
      "utf8",
    );

    await config({ cwd: workDir });

    const parsed = JSON.parse(logs[0] ?? "");
    expect(parsed.agent).toBe("claude-acp");
    expect(parsed.maxIterations).toBe(5);
    expect(parsed.sentinel).toBe(":::LOOPER_DONE:::");
  });
});

describe("agents", () => {
  it("lists cached agents in a table", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((msg: unknown) =>
      logs.push(String(msg)),
    );

    const registry: AcpRegistry = {
      version: "1.0.0",
      agents: [
        {
          id: "claude-acp",
          name: "Claude Agent",
          version: "0.37.0",
          description: "ACP wrapper for Claude",
          distribution: {
            npx: { package: "@agentclientprotocol/claude-agent-acp@0.37.0" },
          },
        },
        {
          id: "pi-acp",
          name: "Pi Agent",
          version: "0.22.0",
          description: "ACP wrapper for Pi",
          distribution: {
            uvx: { package: "pi-agent" },
          },
        },
      ],
    };

    const readCachedRegistry = vi.fn().mockResolvedValue(registry);
    const fetchAndCacheRegistry = vi.fn();

    await agents(
      { refresh: false },
      { readCachedRegistry, fetchAndCacheRegistry },
    );

    expect(readCachedRegistry).toHaveBeenCalled();
    expect(fetchAndCacheRegistry).not.toHaveBeenCalled();

    const header = logs.find((l) => l.includes("ID") && l.includes("NAME"));
    expect(header).toBeDefined();
    expect(logs.some((l) => l.includes("claude-acp"))).toBe(true);
    expect(logs.some((l) => l.includes("pi-acp"))).toBe(true);
    expect(logs.some((l) => l.includes("npx"))).toBe(true);
    expect(logs.some((l) => l.includes("uvx"))).toBe(true);
  });

  it("refreshes the registry when --refresh is set", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((msg: unknown) =>
      logs.push(String(msg)),
    );

    const registry: AcpRegistry = {
      version: "1.0.0",
      agents: [
        {
          id: "codex-acp",
          name: "Codex Agent",
          version: "0.10.0",
          description: "ACP wrapper for Codex",
          distribution: {
            npx: { package: "@agentclientprotocol/codex-agent-acp@0.10.0" },
          },
        },
      ],
    };

    const fetchAndCacheRegistry = vi.fn().mockResolvedValue(registry);
    const readCachedRegistry = vi.fn();

    await agents(
      { refresh: true },
      { fetchAndCacheRegistry, readCachedRegistry },
    );

    expect(fetchAndCacheRegistry).toHaveBeenCalled();
    expect(readCachedRegistry).not.toHaveBeenCalled();
    expect(
      logs.some((l) => l.includes("Fetched 1 agents from the ACP registry")),
    ).toBe(true);
    expect(logs.some((l) => l.includes("codex-acp"))).toBe(true);
  });

  it("exits with error when no cache exists and no --refresh", async () => {
    const errors: string[] = [];
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });
    vi.spyOn(console, "error").mockImplementation((msg: unknown) =>
      errors.push(String(msg)),
    );

    const readCachedRegistry = vi.fn().mockResolvedValue(null);
    const fetchAndCacheRegistry = vi.fn();

    await expect(
      agents({ refresh: false }, { readCachedRegistry, fetchAndCacheRegistry }),
    ).rejects.toThrow("exit");

    expect(readCachedRegistry).toHaveBeenCalled();
    expect(fetchAndCacheRegistry).not.toHaveBeenCalled();
    expect(errors.some((e) => /No registry cache found/i.test(e))).toBe(true);
    exitSpy.mockRestore();
  });

  it("prints a message when the registry has no agents", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((msg: unknown) =>
      logs.push(String(msg)),
    );

    const registry: AcpRegistry = { version: "1.0.0", agents: [] };
    const readCachedRegistry = vi.fn().mockResolvedValue(registry);
    const fetchAndCacheRegistry = vi.fn();

    await agents(
      { refresh: false },
      { readCachedRegistry, fetchAndCacheRegistry },
    );

    expect(logs.some((l) => /No agents in registry/i.test(l))).toBe(true);
  });
});
