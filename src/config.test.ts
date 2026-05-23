import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type CliOverrides,
  configSchema,
  DEFAULT_CONFIG,
  loadConfig,
  resolveConfig,
  writeDefaultConfig,
} from "./config.js";

describe("config", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "looper-acp-config-"));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("configSchema accepts valid config objects", () => {
    const result = configSchema.safeParse({
      agent: "claude-acp",
      maxIterations: 5,
      sentinel: "DONE",
      vars: { KEY: "value" },
      debug: true,
    });
    expect(result.success).toBe(true);
  });

  it("configSchema rejects invalid maxIterations", () => {
    const result = configSchema.safeParse({ maxIterations: "five" });
    expect(result.success).toBe(false);
  });

  it("resolveConfig returns defaults when no file or CLI values provided", () => {
    const resolved = resolveConfig(null);
    expect(resolved).toEqual(DEFAULT_CONFIG);
  });

  it("resolveConfig merges file values over defaults", () => {
    const resolved = resolveConfig({ maxIterations: 3, sentinel: "STOP" });
    expect(resolved.maxIterations).toBe(3);
    expect(resolved.sentinel).toBe("STOP");
    expect(resolved.agent).toBeUndefined();
    expect(resolved.debug).toBe(false);
  });

  it("resolveConfig lets CLI flags win over file values", () => {
    const file = { maxIterations: 3, sentinel: "STOP", agent: "claude-acp" };
    const cli: CliOverrides = { maxIterations: 7, sentinel: "DONE" };
    const resolved = resolveConfig(file, cli);
    expect(resolved.maxIterations).toBe(7);
    expect(resolved.sentinel).toBe("DONE");
    expect(resolved.agent).toBe("claude-acp");
  });

  it("resolveConfig merges CLI vars over file vars", () => {
    const file = { vars: { A: "1", B: "2" } };
    const cli: CliOverrides = { vars: { B: "3", C: "4" } };
    const resolved = resolveConfig(file, cli);
    expect(resolved.vars).toEqual({ A: "1", B: "3", C: "4" });
  });

  it("agentCommand wins when both agent and agentCommand are present", () => {
    const resolved = resolveConfig({
      agent: "claude-acp",
      agentCommand: "npx -y custom-agent",
    });
    expect(resolved.agent).toBeUndefined();
    expect(resolved.agentCommand).toBe("npx -y custom-agent");
  });

  it("agentCommand wins when both are present even from CLI and file", () => {
    const resolved = resolveConfig(
      { agent: "claude-acp" },
      { agentCommand: "npx -y custom-agent" },
    );
    expect(resolved.agent).toBeUndefined();
    expect(resolved.agentCommand).toBe("npx -y custom-agent");
  });

  it("loadConfig reads a valid file from .looper-acp/config.json", async () => {
    await mkdir(path.join(workDir, ".looper-acp"), { recursive: true });
    await writeFile(
      path.join(workDir, ".looper-acp", "config.json"),
      JSON.stringify({ agent: "codex-acp", maxIterations: 5 }),
      "utf8",
    );
    const config = await loadConfig(workDir);
    expect(config).toEqual({ agent: "codex-acp", maxIterations: 5 });
  });

  it("loadConfig returns null when the file does not exist", async () => {
    const config = await loadConfig(workDir);
    expect(config).toBeNull();
  });

  it("loadConfig throws on invalid JSON", async () => {
    await mkdir(path.join(workDir, ".looper-acp"), { recursive: true });
    await writeFile(
      path.join(workDir, ".looper-acp", "config.json"),
      "not json",
      "utf8",
    );
    await expect(loadConfig(workDir)).rejects.toThrow();
  });

  it("writeDefaultConfig writes defaults and refuses to overwrite", async () => {
    const first = await writeDefaultConfig(workDir);
    const raw = await readFile(first, "utf8");
    const parsed = JSON.parse(raw);
    expect(parsed.maxIterations).toBe(DEFAULT_CONFIG.maxIterations);
    expect(parsed.sentinel).toBe(DEFAULT_CONFIG.sentinel);
    expect(parsed.vars).toEqual(DEFAULT_CONFIG.vars);
    expect(parsed.agent).toBeUndefined();
    expect(parsed.agentCommand).toBeUndefined();

    await expect(writeDefaultConfig(workDir)).rejects.toThrow(/exists/i);
  });
});
