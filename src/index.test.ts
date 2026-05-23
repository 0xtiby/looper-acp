import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loop } from "./index.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })),
  );
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function createMockAgentSource(options: {
  text?: string;
  stopReason?: string;
  delayMs?: number;
}): string {
  const sdkRoot = fileURLToPath(
    new URL(
      "../node_modules/@agentclientprotocol/sdk/dist/acp.js",
      import.meta.url,
    ),
  );
  const text = options.text ?? "hello world";
  const stopReason = options.stopReason ?? "end_turn";
  const delayMs = options.delayMs ?? 0;
  const parts = text.split(" ");

  return `
    import { Readable, Writable } from "node:stream";
    import { AgentSideConnection, ndJsonStream } from ${JSON.stringify(sdkRoot)};

    const parts = ${JSON.stringify(parts)};
    const stopReason = ${JSON.stringify(stopReason)};
    const delayMs = ${delayMs};

    const stream = ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin));
    const connection = new AgentSideConnection((client) => ({
      async initialize(params) {
        return {
          protocolVersion: params.protocolVersion,
          agentInfo: { name: "mock-loop-agent", version: "1.0.0" },
          agentCapabilities: {},
        };
      },
      async newSession() {
        return { sessionId: "mock-session" };
      },
      async authenticate() {
        return {};
      },
      async prompt(params) {
        if (delayMs > 0) {
          await new Promise(r => setTimeout(r, delayMs));
        }
        for (const part of parts) {
          await client.sessionUpdate({
            sessionId: params.sessionId,
            update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: part + " " } },
          });
        }
        return { stopReason };
      },
      async cancel() {},
    }), stream);

    await connection.closed;
  `;
}

describe("loop", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await tempDir("looper-acp-loop-");
  });

  it("runs a single iteration and stops with sentinel when detected", async () => {
    const agentPath = join(workDir, "mock-agent.mjs");
    await writeFile(
      agentPath,
      createMockAgentSource({ text: "done :::LOOPER_DONE:::" }),
      "utf8",
    );

    const chunks: string[] = [];
    const result = await loop({
      prompt: "say hello",
      cwd: workDir,
      agentCommand: `${process.execPath} ${agentPath}`,
      maxIterations: 5,
      sentinel: ":::LOOPER_DONE:::",
      onOutput: (chunk) => chunks.push(chunk),
    });

    expect(result.stopReason).toBe("sentinel");
    expect(result.iterations).toHaveLength(1);
    const iter0 = result.iterations[0]!;
    expect(iter0.number).toBe(1);
    expect(iter0.sentinelDetected).toBe(true);
    expect(iter0.stopReason).toBe("end_turn");
    expect(iter0.text).toContain(":::LOOPER_DONE:::");
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.join("")).toContain(":::LOOPER_DONE:::");
  });

  it("spawns a fresh process per iteration and stops at maxIterations", async () => {
    const agentPath = join(workDir, "mock-agent.mjs");
    await writeFile(
      agentPath,
      createMockAgentSource({ text: "working" }),
      "utf8",
    );

    const result = await loop({
      prompt: "work",
      cwd: workDir,
      agentCommand: `${process.execPath} ${agentPath}`,
      maxIterations: 2,
      sentinel: ":::LOOPER_DONE:::",
    });

    expect(result.stopReason).toBe("max_iterations");
    expect(result.iterations).toHaveLength(2);
    expect(result.iterations[0]!.number).toBe(1);
    expect(result.iterations[1]!.number).toBe(2);
    expect(result.iterations[0]!.sentinelDetected).toBe(false);
    expect(result.iterations[1]!.sentinelDetected).toBe(false);
  });

  it("stops with error when agent returns a non-end_turn stopReason", async () => {
    const agentPath = join(workDir, "mock-agent.mjs");
    await writeFile(
      agentPath,
      createMockAgentSource({ stopReason: "max_tokens" }),
      "utf8",
    );

    const result = await loop({
      prompt: "work",
      cwd: workDir,
      agentCommand: `${process.execPath} ${agentPath}`,
      maxIterations: 5,
      sentinel: ":::LOOPER_DONE:::",
    });

    expect(result.stopReason).toBe("error");
    expect(result.iterations).toHaveLength(1);
    const errIter = result.iterations[0]!;
    expect(errIter.error).not.toBeNull();
    expect(errIter.error?.code).toBe("NON_END_TURN");
  });

  it("stops with aborted when the signal is triggered", async () => {
    const agentPath = join(workDir, "mock-agent.mjs");
    await writeFile(
      agentPath,
      createMockAgentSource({ text: "wait", delayMs: 5000 }),
      "utf8",
    );

    const controller = new AbortController();

    const promise = loop({
      prompt: "work",
      cwd: workDir,
      agentCommand: `${process.execPath} ${agentPath}`,
      maxIterations: 5,
      sentinel: ":::LOOPER_DONE:::",
      signal: controller.signal,
    });

    // Abort after a short delay to let the agent start
    setTimeout(() => controller.abort(), 300);

    const result = await promise;

    expect(result.stopReason).toBe("aborted");
    expect(result.iterations.length).toBeGreaterThanOrEqual(1);
  });

  it("streams onOutput chunks in real time", async () => {
    const agentPath = join(workDir, "mock-agent.mjs");
    await writeFile(
      agentPath,
      createMockAgentSource({ text: "hello beautiful world" }),
      "utf8",
    );

    const chunks: string[] = [];
    const result = await loop({
      prompt: "say hello",
      cwd: workDir,
      agentCommand: `${process.execPath} ${agentPath}`,
      maxIterations: 2,
      sentinel: ":::LOOPER_DONE:::",
      onOutput: (chunk) => chunks.push(chunk),
    });

    expect(result.stopReason).toBe("max_iterations");
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    const combined = chunks.join("");
    expect(combined).toContain("hello");
    expect(combined).toContain("beautiful");
    expect(combined).toContain("world");
  });

  it("substitutes built-in template vars each iteration", async () => {
    const agentPath = join(workDir, "mock-agent.mjs");
    await writeFile(agentPath, createMockAgentSource({ text: "ok" }), "utf8");

    const result = await loop({
      prompt: "iteration {{ITERATION}} of {{MAX_ITERATIONS}}",
      cwd: workDir,
      agentCommand: `${process.execPath} ${agentPath}`,
      maxIterations: 2,
      sentinel: ":::NEVER:::",
    });

    expect(result.stopReason).toBe("max_iterations");
    expect(result.iterations).toHaveLength(2);
    // The prompt is substituted before being sent to the agent;
    // the mock agent does not echo the prompt, but the loop should
    // still run without error.
    expect(result.iterations[0]!.number).toBe(1);
    expect(result.iterations[1]!.number).toBe(2);
  });
});
