import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { Readable, Writable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import {
  type Client,
  ClientSideConnection,
  ndJsonStream,
  type SessionNotification,
} from "@agentclientprotocol/sdk";

/**
 * ACP Client implementation for Looper ACP.
 *
 * Implements the ACP Client interface:
 *   - readTextFile / writeTextFile: pass-through to fs in cwd
 *   - requestPermission: auto-approve first option
 *   - sessionUpdate: stream text chunks to onOutput, collect transcript
 */

export interface CreateLooperAcpClientOptions {
  cwd: string;
  onOutput?: (chunk: string) => void;
  onSessionUpdate?: (notification: SessionNotification) => void;
}

export interface LooperAcpClient extends Client {
  getTranscript(): string;
  getSessionUpdates(): SessionNotification[];
}

export interface AcpSpawnCommand {
  bin: string;
  args?: string[];
  env?: Record<string, string | undefined>;
}

export interface AcpHelloWorldOptions {
  prompt: string;
  cwd: string;
  command?: AcpSpawnCommand;
  onOutput?: (chunk: string) => void;
}

export interface AcpHelloWorldResult {
  protocolVersion: number;
  sessionId: string;
  stopReason: string;
  text: string;
  killed: boolean;
}

export interface AcpIterationOptions {
  prompt: string;
  cwd: string;
  command: AcpSpawnCommand;
  onOutput?: (chunk: string) => void;
  onSessionUpdate?: (notification: SessionNotification) => void;
  signal?: AbortSignal;
}

export interface AcpIterationResult {
  protocolVersion: number;
  sessionId: string;
  stopReason: string;
  text: string;
  killed: boolean;
  durationMs: number;
  startedAt: string;
  error: Error | null;
}

const DEFAULT_PROTOCOL_VERSION = 1;

export function createLooperAcpClient(
  options: CreateLooperAcpClientOptions,
): LooperAcpClient {
  const cwd = resolve(options.cwd);
  const transcript: string[] = [];
  const sessionUpdates: SessionNotification[] = [];

  return {
    async readTextFile(params) {
      const content = await readFile(
        resolveClientPath(cwd, params.path),
        "utf8",
      );
      return {
        content: sliceLines(
          content,
          params.line ?? undefined,
          params.limit ?? undefined,
        ),
      };
    },

    async writeTextFile(params) {
      const path = resolveClientPath(cwd, params.path);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, params.content, "utf8");
      return {};
    },

    async requestPermission(params) {
      const option = params.options[0];
      if (!option) return { outcome: { outcome: "cancelled" } };
      return { outcome: { outcome: "selected", optionId: option.optionId } };
    },

    async sessionUpdate(notification) {
      sessionUpdates.push(notification);
      options.onSessionUpdate?.(notification);

      if (notification.update.sessionUpdate !== "agent_message_chunk") return;
      if (notification.update.content.type !== "text") return;

      const chunk = notification.update.content.text;
      transcript.push(chunk);
      options.onOutput?.(chunk);
    },

    getTranscript() {
      return transcript.join("");
    },

    getSessionUpdates() {
      return [...sessionUpdates];
    },
  };
}

export async function runAcpHelloWorld(
  options: AcpHelloWorldOptions,
): Promise<AcpHelloWorldResult> {
  const result = await runAcpIteration({
    prompt: options.prompt,
    cwd: options.cwd,
    command: options.command ?? defaultHelloWorldCommand(),
    onOutput: options.onOutput,
  });
  return {
    protocolVersion: result.protocolVersion,
    sessionId: result.sessionId,
    stopReason: result.stopReason,
    text: result.text,
    killed: result.killed,
  };
}

export async function runAcpIteration(
  options: AcpIterationOptions,
): Promise<AcpIterationResult> {
  const startedAt = new Date().toISOString();
  const startTime = Date.now();
  const cwd = resolve(options.cwd);
  const command = options.command;
  const child = spawn(command.bin, command.args ?? [], {
    cwd,
    env: { ...process.env, ...command.env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stderr: string[] = [];
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => stderr.push(chunk));

  const client = createLooperAcpClient({
    cwd,
    onOutput: options.onOutput,
    onSessionUpdate: options.onSessionUpdate,
  });
  const connection = new ClientSideConnection(
    () => client,
    ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)),
  );

  let killed = false;
  let sessionId = "";
  let aborted = false;

  const onAbort = async () => {
    aborted = true;
    if (sessionId) {
      try {
        await connection.cancel({ sessionId });
      } catch {
        // ignore
      }
    }
    await terminateChild(child);
  };

  options.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const initializeResponse = await connection.initialize({
      protocolVersion: DEFAULT_PROTOCOL_VERSION,
      clientInfo: { name: "looper-acp", version: "0.0.0-development" },
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
    });
    const session = await connection.newSession({ cwd, mcpServers: [] });
    sessionId = session.sessionId;

    const promptResponse = await connection.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: options.prompt }],
    });

    // Check if agent exited with non-zero code before we kill it
    if (child.exitCode !== null && child.exitCode !== 0) {
      throw new Error(`Agent exited with non-zero code: ${child.exitCode}`);
    }

    killed = await terminateChild(child);

    if (aborted || options.signal?.aborted) {
      return {
        protocolVersion: initializeResponse.protocolVersion,
        sessionId,
        stopReason: "cancelled",
        text: client.getTranscript(),
        killed,
        durationMs: Date.now() - startTime,
        startedAt,
        error: null,
      };
    }

    return {
      protocolVersion: initializeResponse.protocolVersion,
      sessionId,
      stopReason: promptResponse.stopReason,
      text: client.getTranscript(),
      killed,
      durationMs: Date.now() - startTime,
      startedAt,
      error: null,
    };
  } catch (error) {
    await terminateChild(child);

    if (aborted || options.signal?.aborted) {
      return {
        protocolVersion: DEFAULT_PROTOCOL_VERSION,
        sessionId,
        stopReason: "cancelled",
        text: client.getTranscript(),
        killed: true,
        durationMs: Date.now() - startTime,
        startedAt,
        error: null,
      };
    }

    const stderrText = stderr.join("").trim();
    if (stderrText.length > 0 && error instanceof Error) {
      error.message = `${error.message}\nAgent stderr:\n${stderrText}`;
    }
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
    await connection.closed.catch(() => undefined);
  }
}

function resolveClientPath(cwd: string, path: string): string {
  return isAbsolute(path) ? path : resolve(cwd, path);
}

function sliceLines(content: string, line?: number, limit?: number): string {
  if (line === undefined && limit === undefined) return content;

  const lines = content.split("\n");
  const start = Math.max((line ?? 1) - 1, 0);
  const end = limit === undefined ? undefined : start + Math.max(limit, 0);
  return lines.slice(start, end).join("\n");
}

async function terminateChild(
  child: ChildProcessWithoutNullStreams,
): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return false;

  const exited = onceExit(child);
  child.kill("SIGTERM");

  const cleanExit = await Promise.race([
    exited.then(() => true),
    delay(1_000).then(() => false),
  ]);
  if (cleanExit) return true;

  child.kill("SIGKILL");
  await exited;
  return true;
}

function onceExit(child: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolveExit) => {
    child.once("exit", () => resolveExit());
  });
}

function defaultHelloWorldCommand(): AcpSpawnCommand {
  return {
    bin: process.execPath,
    args: ["--input-type=module", "--eval", defaultHelloWorldAgentSource()],
  };
}

function defaultHelloWorldAgentSource(): string {
  return `
    import { Readable, Writable } from "node:stream";
    import { AgentSideConnection, ndJsonStream } from "@agentclientprotocol/sdk";

    const stream = ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin));
    const connection = new AgentSideConnection((client) => ({
      async initialize(params) {
        return {
          protocolVersion: params.protocolVersion,
          agentInfo: { name: "looper-acp-mock-agent", version: "1.0.0" },
          agentCapabilities: {},
        };
      },
      async newSession() {
        return { sessionId: "looper-acp-hello-world" };
      },
      async authenticate() {
        return {};
      },
      async prompt(params) {
        await client.sessionUpdate({
          sessionId: params.sessionId,
          update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hello from ACP" } },
        });
        return { stopReason: "end_turn" };
      },
      async cancel() {},
    }), stream);

    await connection.closed;
  `;
}
