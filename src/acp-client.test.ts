import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createLooperAcpClient, runAcpHelloWorld } from "./acp-client.js";

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

describe("createLooperAcpClient", () => {
  it("passes readTextFile and writeTextFile through to the filesystem", async () => {
    const cwd = await tempDir("looper-acp-client-");
    const sourcePath = join(cwd, "source.txt");
    const targetPath = join(cwd, "nested", "target.txt");
    await writeFile(sourcePath, "line 1\nline 2\nline 3\n");

    const client = createLooperAcpClient({ cwd });

    await expect(
      client.readTextFile?.({ sessionId: "s", path: sourcePath }),
    ).resolves.toEqual({
      content: "line 1\nline 2\nline 3\n",
    });
    await client.writeTextFile?.({
      sessionId: "s",
      path: targetPath,
      content: "written",
    });

    await expect(readFile(targetPath, "utf8")).resolves.toBe("written");
  });

  it("auto-approves permission requests with the first option", async () => {
    const client = createLooperAcpClient({
      cwd: await tempDir("looper-acp-permission-"),
    });

    await expect(
      client.requestPermission({
        sessionId: "s",
        toolCall: { toolCallId: "tool-1" },
        options: [
          { optionId: "allow", name: "Allow", kind: "allow_once" },
          { optionId: "reject", name: "Reject", kind: "reject_once" },
        ],
      }),
    ).resolves.toEqual({ outcome: { outcome: "selected", optionId: "allow" } });
  });

  it("streams agent message chunks and keeps a text transcript", async () => {
    const chunks: string[] = [];
    const client = createLooperAcpClient({
      cwd: await tempDir("looper-acp-stream-"),
      onOutput: (chunk) => chunks.push(chunk),
    });

    await client.sessionUpdate({
      sessionId: "s",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "hello " },
      },
    });
    await client.sessionUpdate({
      sessionId: "s",
      update: {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "hidden" },
      },
    });
    await client.sessionUpdate({
      sessionId: "s",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "world" },
      },
    });

    expect(chunks).toEqual(["hello ", "world"]);
    expect(client.getTranscript()).toBe("hello world");
  });
});

describe("runAcpHelloWorld", () => {
  it("spawns an ACP subprocess, completes initialize/newSession/prompt, streams text, and kills the agent", async () => {
    const cwd = await tempDir("looper-acp-hello-");
    const readPath = join(cwd, "input.txt");
    const writePath = join(cwd, "output.txt");
    const markerPath = join(cwd, "agent-exit.txt");
    await writeFile(readPath, "from client fs");

    const agentPath = join(cwd, "mock-agent.mjs");
    await writeFile(agentPath, mockAgentSource());

    const chunks: string[] = [];
    const result = await runAcpHelloWorld({
      cwd,
      prompt: "say hello",
      command: {
        bin: process.execPath,
        args: [agentPath],
        env: {
          MARKER_FILE: markerPath,
          READ_FILE: readPath,
          WRITE_FILE: writePath,
        },
      },
      onOutput: (chunk) => chunks.push(chunk),
    });

    expect(result.protocolVersion).toBe(1);
    expect(result.sessionId).toBe("mock-session");
    expect(result.stopReason).toBe("end_turn");
    expect(result.text).toBe("hello world");
    expect(chunks).toEqual(["hello ", "world"]);
    expect(result.killed).toBe(true);
    await expect(readFile(writePath, "utf8")).resolves.toBe(
      "from client fs -> written",
    );
    await expect(readFile(markerPath, "utf8")).resolves.toBe("terminated");
  });
});

function mockAgentSource(): string {
  const sdkRoot = fileURLToPath(
    new URL(
      "../node_modules/@agentclientprotocol/sdk/dist/acp.js",
      import.meta.url,
    ),
  );
  return `
    import { writeFile } from "node:fs/promises";
    import { Readable, Writable } from "node:stream";
    import { AgentSideConnection, ndJsonStream } from ${JSON.stringify(sdkRoot)};

    let interval;
    const stream = ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin));
    const connection = new AgentSideConnection((client) => ({
      async initialize(params) {
        return {
          protocolVersion: params.protocolVersion,
          agentInfo: { name: "mock-agent", version: "1.0.0" },
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
        await client.requestPermission({
          sessionId: params.sessionId,
          toolCall: { toolCallId: "tool-1" },
          options: [
            { optionId: "allow", name: "Allow", kind: "allow_once" },
            { optionId: "reject", name: "Reject", kind: "reject_once" },
          ],
        });
        const read = await client.readTextFile({ sessionId: params.sessionId, path: process.env.READ_FILE });
        await client.writeTextFile({
          sessionId: params.sessionId,
          path: process.env.WRITE_FILE,
          content: read.content + " -> written",
        });
        await client.sessionUpdate({
          sessionId: params.sessionId,
          update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hello " } },
        });
        await new Promise((resolve) => setTimeout(resolve, 20));
        await client.sessionUpdate({
          sessionId: params.sessionId,
          update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "world" } },
        });
        interval = setInterval(() => {}, 1_000);
        return { stopReason: "end_turn" };
      },
      async cancel() {},
    }), stream);

    process.on("SIGTERM", async () => {
      if (interval) clearInterval(interval);
      await writeFile(process.env.MARKER_FILE, "terminated");
      process.exit(0);
    });

    await connection.closed;
  `;
}
