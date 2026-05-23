import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agents, config, init, resume, run } from "./cli.js";
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

describe("resume", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "looper-acp-cli-resume-"));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("lists interrupted sessions when no session-id is given", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((msg: unknown) =>
      logs.push(String(msg)),
    );

    const listInterruptedSessions = vi.fn().mockResolvedValue([
      {
        id: "session-1",
        state: "interrupted",
        createdAt: "2026-05-23T10:00:00.000Z",
        prompt: "fix bug",
        maxIterations: 5,
        sentinel: ":::DONE:::",
        vars: {},
        cwd: workDir,
        debug: false,
        iterations: [{ number: 1 }, { number: 2 }],
      },
    ]);

    await resume(
      { cwd: workDir },
      {
        listInterruptedSessions,
        resumeLoop: vi.fn(),
        readCachedRegistry: vi.fn(),
        resolveAgent: vi.fn(),
      },
    );

    expect(listInterruptedSessions).toHaveBeenCalledWith(workDir);
    expect(logs.some((l) => l.includes("session-1"))).toBe(true);
    expect(logs.some((l) => l.includes("fix bug"))).toBe(true);
    expect(logs.some((l) => l.includes("iterations: 2"))).toBe(true);
  });

  it("prints a message when no interrupted sessions exist", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((msg: unknown) =>
      logs.push(String(msg)),
    );

    const listInterruptedSessions = vi.fn().mockResolvedValue([]);

    await resume(
      { cwd: workDir },
      {
        listInterruptedSessions,
        resumeLoop: vi.fn(),
        readCachedRegistry: vi.fn(),
        resolveAgent: vi.fn(),
      },
    );

    expect(logs.some((l) => /No interrupted sessions/i.test(l))).toBe(true);
  });

  it("resumes a specific session and prints summary", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((msg: unknown) =>
      logs.push(String(msg)),
    );

    const resumeLoop = vi.fn().mockResolvedValue({
      stopReason: "sentinel",
      iterations: [{ number: 1 }, { number: 2 }, { number: 3 }],
    });

    await resume(
      { cwd: workDir, sessionId: "session-abc" },
      {
        listInterruptedSessions: vi.fn(),
        resumeLoop,
        readCachedRegistry: vi.fn().mockResolvedValue({
          version: "1.0.0",
          agents: [],
        } as AcpRegistry),
        resolveAgent: vi.fn(),
      },
    );

    expect(resumeLoop).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: workDir, sessionId: "session-abc" }),
      expect.anything(),
    );
    expect(logs.some((l) => l.includes("session-abc"))).toBe(true);
    expect(logs.some((l) => l.includes("sentinel"))).toBe(true);
    expect(logs.some((l) => l.includes("3"))).toBe(true);
  });
});

describe("run", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "looper-acp-cli-run-"));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("runs with inline prompt and prints summary", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((msg: unknown) =>
      logs.push(String(msg)),
    );

    const loop = vi.fn().mockResolvedValue({
      stopReason: "sentinel",
      iterations: [{ number: 1 }],
    });
    const loadConfig = vi.fn().mockResolvedValue(null);
    const resolveConfig = vi.fn().mockReturnValue({
      agent: "test-agent",
      agentCommand: undefined,
      maxIterations: 10,
      sentinel: ":::DONE:::",
      vars: {},
      debug: false,
    });
    const resolveAgent = vi.fn();
    const readCachedRegistry = vi.fn().mockResolvedValue({
      version: "1.0.0",
      agents: [],
    } as AcpRegistry);

    await run(
      { prompt: "fix bug", var: {} },
      { loop, loadConfig, resolveConfig, resolveAgent, readCachedRegistry },
    );

    expect(loop).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "fix bug", cwd: expect.any(String) }),
      expect.anything(),
    );
    expect(logs.some((l) => l.includes("sentinel"))).toBe(true);
    expect(logs.some((l) => l.includes("1"))).toBe(true);
  });

  it("reads prompt from file when -p points to a file", async () => {
    const promptFile = path.join(workDir, "prompt.md");
    await writeFile(promptFile, "file prompt content", "utf8");

    const loop = vi.fn().mockResolvedValue({
      stopReason: "max_iterations",
      iterations: [],
    });
    const loadConfig = vi.fn().mockResolvedValue(null);
    const resolveConfig = vi.fn().mockReturnValue({
      agent: "test-agent",
      agentCommand: undefined,
      maxIterations: 5,
      sentinel: ":::DONE:::",
      vars: {},
      debug: false,
    });
    const resolveAgent = vi.fn();
    const readCachedRegistry = vi.fn().mockResolvedValue({
      version: "1.0.0",
      agents: [],
    } as AcpRegistry);

    await run(
      { prompt: promptFile, var: {} },
      { loop, loadConfig, resolveConfig, resolveAgent, readCachedRegistry },
    );

    expect(loop).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "file prompt content" }),
      expect.anything(),
    );
  });

  it("reads prompt from stdin when --prompt-stdin is set", async () => {
    const originalStdin = process.stdin;
    const mockStdin = new PassThrough();
    Object.defineProperty(process, "stdin", {
      value: mockStdin,
      writable: true,
      configurable: true,
    });

    const loop = vi.fn().mockResolvedValue({
      stopReason: "max_iterations",
      iterations: [],
    });
    const loadConfig = vi.fn().mockResolvedValue(null);
    const resolveConfig = vi.fn().mockReturnValue({
      agent: "test-agent",
      agentCommand: undefined,
      maxIterations: 5,
      sentinel: ":::DONE:::",
      vars: {},
      debug: false,
    });
    const resolveAgent = vi.fn();
    const readCachedRegistry = vi.fn().mockResolvedValue({
      version: "1.0.0",
      agents: [],
    } as AcpRegistry);

    const promise = run(
      { promptStdin: true, var: {} },
      { loop, loadConfig, resolveConfig, resolveAgent, readCachedRegistry },
    );

    mockStdin.end("stdin prompt\n");

    await promise;

    expect(loop).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "stdin prompt\n" }),
      expect.anything(),
    );

    Object.defineProperty(process, "stdin", {
      value: originalStdin,
      writable: true,
      configurable: true,
    });
  });

  it("passes CLI overrides to resolveConfig with correct precedence", async () => {
    const loop = vi.fn().mockResolvedValue({
      stopReason: "sentinel",
      iterations: [],
    });
    const loadConfig = vi.fn().mockResolvedValue({
      agent: "config-agent",
      maxIterations: 3,
    });
    const resolveConfig = vi.fn().mockReturnValue({
      agent: "cli-agent",
      agentCommand: "npx -y some-agent",
      maxIterations: 7,
      sentinel: ":::STOP:::",
      vars: { FOO: "bar" },
      debug: true,
    });
    const resolveAgent = vi.fn();
    const readCachedRegistry = vi.fn().mockResolvedValue({
      version: "1.0.0",
      agents: [],
    } as AcpRegistry);

    await run(
      {
        prompt: "work",
        agent: "cli-agent",
        agentCommand: "npx -y some-agent",
        maxIterations: "7",
        sentinel: ":::STOP:::",
        var: { FOO: "bar" },
        debug: true,
      },
      { loop, loadConfig, resolveConfig, resolveAgent, readCachedRegistry },
    );

    expect(loadConfig).toHaveBeenCalledWith(expect.any(String));
    expect(resolveConfig).toHaveBeenCalledWith(
      expect.objectContaining({ agent: "config-agent", maxIterations: 3 }),
      expect.objectContaining({
        agent: "cli-agent",
        agentCommand: "npx -y some-agent",
        maxIterations: 7,
        sentinel: ":::STOP:::",
        vars: { FOO: "bar" },
        debug: true,
      }),
    );
  });

  it("exits with 0 on sentinel stop", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });

    const loop = vi.fn().mockResolvedValue({
      stopReason: "sentinel",
      iterations: [],
    });
    const loadConfig = vi.fn().mockResolvedValue(null);
    const resolveConfig = vi.fn().mockReturnValue({
      agent: "test-agent",
      agentCommand: undefined,
      maxIterations: 10,
      sentinel: ":::DONE:::",
      vars: {},
      debug: false,
    });
    const resolveAgent = vi.fn();
    const readCachedRegistry = vi.fn().mockResolvedValue({
      version: "1.0.0",
      agents: [],
    } as AcpRegistry);

    await run(
      { prompt: "work", var: {} },
      { loop, loadConfig, resolveConfig, resolveAgent, readCachedRegistry },
    );

    expect(exitSpy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it("exits with 1 on error stop", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });

    const loop = vi.fn().mockResolvedValue({
      stopReason: "error",
      iterations: [],
    });
    const loadConfig = vi.fn().mockResolvedValue(null);
    const resolveConfig = vi.fn().mockReturnValue({
      agent: "test-agent",
      agentCommand: undefined,
      maxIterations: 10,
      sentinel: ":::DONE:::",
      vars: {},
      debug: false,
    });
    const resolveAgent = vi.fn();
    const readCachedRegistry = vi.fn().mockResolvedValue({
      version: "1.0.0",
      agents: [],
    } as AcpRegistry);

    await expect(
      run(
        { prompt: "work", var: {} },
        { loop, loadConfig, resolveConfig, resolveAgent, readCachedRegistry },
      ),
    ).rejects.toThrow("exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it("exits with 130 on aborted stop", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });

    const loop = vi.fn().mockResolvedValue({
      stopReason: "aborted",
      iterations: [],
    });
    const loadConfig = vi.fn().mockResolvedValue(null);
    const resolveConfig = vi.fn().mockReturnValue({
      agent: "test-agent",
      agentCommand: undefined,
      maxIterations: 10,
      sentinel: ":::DONE:::",
      vars: {},
      debug: false,
    });
    const resolveAgent = vi.fn();
    const readCachedRegistry = vi.fn().mockResolvedValue({
      version: "1.0.0",
      agents: [],
    } as AcpRegistry);

    await expect(
      run(
        { prompt: "work", var: {} },
        { loop, loadConfig, resolveConfig, resolveAgent, readCachedRegistry },
      ),
    ).rejects.toThrow("exit");

    expect(exitSpy).toHaveBeenCalledWith(130);
    exitSpy.mockRestore();
  });

  it("exits with 1 when neither agent nor agentCommand is provided", async () => {
    const errors: string[] = [];
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });
    vi.spyOn(console, "error").mockImplementation((msg: unknown) =>
      errors.push(String(msg)),
    );

    const loop = vi.fn();
    const loadConfig = vi.fn().mockResolvedValue(null);
    const resolveConfig = vi.fn().mockReturnValue({
      agent: undefined,
      agentCommand: undefined,
      maxIterations: 10,
      sentinel: ":::DONE:::",
      vars: {},
      debug: false,
    });
    const resolveAgent = vi.fn();
    const readCachedRegistry = vi.fn();

    await expect(
      run(
        { prompt: "work", var: {} },
        { loop, loadConfig, resolveConfig, resolveAgent, readCachedRegistry },
      ),
    ).rejects.toThrow("exit");

    expect(loop).not.toHaveBeenCalled();
    expect(errors.some((e) => /agent/i.test(e))).toBe(true);
    exitSpy.mockRestore();
  });
});
