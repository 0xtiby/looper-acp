import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendSessionEvents,
  appendSessionLog,
  createSession,
  getSessionDir,
  getSessionsDir,
  listInterruptedSessions,
  readSession,
  writeSessionState,
} from "./session.js";

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

describe("session persistence", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await tempDir("looper-acp-session-");
  });

  it("creates session directory and writes initial JSON", async () => {
    const session = {
      id: "test-session-1",
      state: "active" as const,
      createdAt: "2026-05-23T10:00:00.000Z",
      prompt: "hello",
      maxIterations: 5,
      sentinel: ":::DONE:::",
      vars: {},
      cwd: workDir,
      debug: false,
      iterations: [],
    };

    await createSession(session);

    const sessionDir = getSessionDir(workDir, "test-session-1");
    const jsonPath = join(sessionDir, "test-session-1.json");
    const statePath = join(sessionDir, "state");

    const jsonRaw = await readFile(jsonPath, "utf8");
    const saved = JSON.parse(jsonRaw);
    expect(saved.id).toBe("test-session-1");
    expect(saved.state).toBe("active");
    expect(saved.prompt).toBe("hello");

    const stateRaw = await readFile(statePath, "utf8");
    expect(stateRaw.trim()).toBe("active");
  });

  it("appends iteration text to log with marker", async () => {
    const sessionDir = getSessionDir(workDir, "test-session-2");
    await mkdir(sessionDir, { recursive: true });

    const iteration = {
      number: 1,
      stopReason: "end_turn" as string | null,
      sentinelDetected: false,
      text: "hello world",
      startedAt: "2026-05-23T10:00:00.000Z",
      durationMs: 100,
      toolCalls: [],
      error: null,
    };

    await appendSessionLog(sessionDir, iteration);

    const logPath = join(sessionDir, "test-session-2.log");
    const logRaw = await readFile(logPath, "utf8");
    expect(logRaw).toContain("--- ITERATION 1 [2026-05-23T10:00:00.000Z] ---");
    expect(logRaw).toContain("hello world");
  });

  it("writes raw ACP events as NDJSON in debug mode", async () => {
    const sessionDir = getSessionDir(workDir, "test-session-3");
    await mkdir(sessionDir, { recursive: true });

    const events = [
      {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "hi" },
      },
      {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: " there" },
      },
    ];

    await appendSessionEvents(sessionDir, events);

    const eventsPath = join(sessionDir, "test-session-3.events.ndjson");
    const raw = await readFile(eventsPath, "utf8");
    const lines = raw.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] as string).content.text).toBe("hi");
    expect(JSON.parse(lines[1] as string).content.text).toBe(" there");
  });

  it("updates session state file", async () => {
    const sessionDir = getSessionDir(workDir, "test-session-4");
    await mkdir(sessionDir, { recursive: true });

    await writeSessionState(sessionDir, "interrupted");
    const statePath = join(sessionDir, "state");
    expect(await readFile(statePath, "utf8")).toBe("interrupted");

    await writeSessionState(sessionDir, "completed");
    expect(await readFile(statePath, "utf8")).toBe("completed");
  });

  it("lists interrupted sessions", async () => {
    const sessionsDir = getSessionsDir(workDir);
    for (const id of ["s1", "s2", "s3"]) {
      const dir = join(sessionsDir, id);
      await mkdir(dir, { recursive: true });
      const state = id === "s2" ? "interrupted" : "completed";
      await writeFile(join(dir, "state"), state, "utf8");
      await writeFile(
        join(dir, `${id}.json`),
        JSON.stringify({
          id,
          state,
          createdAt: "2026-05-23T10:00:00.000Z",
          prompt: "test",
          maxIterations: 5,
          sentinel: ":::DONE:::",
          vars: {},
          cwd: workDir,
          debug: false,
          iterations: [],
        }),
        "utf8",
      );
    }

    const interrupted = await listInterruptedSessions(workDir);
    expect(interrupted).toHaveLength(1);
    expect(interrupted[0]?.id).toBe("s2");
    expect(interrupted[0]?.state).toBe("interrupted");
  });

  it("reads a session from disk", async () => {
    const sessionDir = getSessionDir(workDir, "test-session-5");
    await mkdir(sessionDir, { recursive: true });
    const session = {
      id: "test-session-5",
      state: "active" as const,
      createdAt: "2026-05-23T10:00:00.000Z",
      prompt: "read me",
      maxIterations: 3,
      sentinel: ":::DONE:::",
      vars: { foo: "bar" },
      cwd: workDir,
      debug: true,
      iterations: [],
    };
    await writeFile(
      join(sessionDir, "test-session-5.json"),
      JSON.stringify(session),
      "utf8",
    );

    const read = await readSession(sessionDir);
    expect(read.id).toBe("test-session-5");
    expect(read.prompt).toBe("read me");
    expect(read.vars.foo).toBe("bar");
  });
});
