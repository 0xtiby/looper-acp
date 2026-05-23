import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AcpRegistrySchema,
  fetchAndCacheRegistry,
  fetchRegistry,
  readCachedRegistry,
  writeCachedRegistry,
} from "./registry.js";

describe("ACP Registry", () => {
  let workDir: string;
  let cachePath: string;

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "looper-acp-registry-"));
    cachePath = path.join(workDir, "registry.json");
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  const sampleRegistry = {
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
    ],
  };

  it("parses a valid inline registry", () => {
    const registry = AcpRegistrySchema.parse(sampleRegistry);
    const agent = registry.agents[0];
    expect(agent).toBeDefined();
    expect(agent).toEqual(
      expect.objectContaining({
        id: "claude-acp",
        name: "Claude Agent",
        distribution: {
          npx: { package: "@agentclientprotocol/claude-agent-acp@0.37.0" },
        },
      }),
    );
  });

  it("fetchRegistry downloads from URL via injected fetch", async () => {
    const fetched = await fetchRegistry(
      "https://example.com/registry.json",
      async () => sampleRegistry,
    );
    expect(fetched.agents[0]?.id).toBe("claude-acp");
  });

  it("fetchRegistry rejects invalid payloads", async () => {
    await expect(
      fetchRegistry("https://example.com/registry.json", async () => ({
        notAgents: [],
      })),
    ).rejects.toThrow();
  });

  it("writeCachedRegistry writes JSON to the cache path", async () => {
    await writeCachedRegistry(sampleRegistry, cachePath);
    const raw = await readFile(cachePath, "utf8");
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe("1.0.0");
    expect(parsed.agents[0].id).toBe("claude-acp");
  });

  it("readCachedRegistry returns null when cache does not exist", async () => {
    const result = await readCachedRegistry(cachePath);
    expect(result).toBeNull();
  });

  it("readCachedRegistry reads back a previously written cache", async () => {
    await writeCachedRegistry(sampleRegistry, cachePath);
    const result = await readCachedRegistry(cachePath);
    expect(result).not.toBeNull();
    expect(result?.agents[0]?.id).toBe("claude-acp");
  });

  it("readCachedRegistry throws on invalid JSON in cache", async () => {
    await writeFile(cachePath, "not json", "utf8");
    await expect(readCachedRegistry(cachePath)).rejects.toThrow();
  });

  it("fetchAndCacheRegistry fetches and persists to cache", async () => {
    const registry = await fetchAndCacheRegistry(
      "https://example.com/registry.json",
      cachePath,
      async () => sampleRegistry,
    );
    expect(registry.agents[0]?.id).toBe("claude-acp");

    const raw = await readFile(cachePath, "utf8");
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe("1.0.0");
  });
});
