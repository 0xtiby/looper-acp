/**
 * Looper ACP — Stateless agent iteration via the Agent Client Protocol.
 *
 * The Ralph Loop: spawn an ACP agent, drive one prompt turn,
 * collect text, check for sentinel, kill the process, repeat.
 *
 * Each iteration is a fresh agent with no shared session state.
 * The filesystem is the only memory between turns.
 */

export type {
  AcpHelloWorldOptions,
  AcpHelloWorldResult,
  AcpSpawnCommand,
  CreateLooperAcpClientOptions,
  LooperAcpClient,
} from "./acp-client.js";
export {
  type AcpIterationOptions,
  type AcpIterationResult,
  createLooperAcpClient,
  runAcpHelloWorld,
  runAcpIteration,
} from "./acp-client.js";

import { randomUUID } from "node:crypto";
import {
  type AcpIterationOptions,
  type AcpIterationResult,
  runAcpIteration,
} from "./acp-client.js";
import { tokenizeCommand } from "./agent-resolver.js";
import {
  appendSessionEvents,
  appendSessionLog,
  createSession,
  getSessionDir,
  readSession,
  type Session,
  writeSessionJson,
  writeSessionState,
} from "./session.js";
import { substitute } from "./template.js";

export type StopReason = "sentinel" | "max_iterations" | "error" | "aborted";

export interface IterationError {
  code: string;
  message: string;
  raw: string;
}

export interface IterationResult {
  number: number;
  stopReason: string | null;
  sentinelDetected: boolean;
  text: string;
  startedAt: string;
  durationMs: number;
  toolCalls: { name: string; status: string }[];
  error: IterationError | null;
}

export interface LoopResult {
  iterations: IterationResult[];
  stopReason: StopReason;
}

export interface LoopOptions {
  /** Registry agent ID or raw spawn command (mutually exclusive with agent) */
  agentCommand?: string;
  /** Registry agent ID */
  agent?: string;
  /** Prompt template */
  prompt: string;
  /** Working directory for the spawned agent */
  cwd: string;
  /** Max iterations (default: 10) */
  maxIterations?: number;
  /** Sentinel string (default: ":::LOOPER_DONE:::") */
  sentinel?: string;
  /** Template variables */
  vars?: Record<string, string>;
  /** Session ID for template substitution */
  sessionId?: string;
  /** Abort signal */
  signal?: AbortSignal;
  /** Starting iteration number (for resume) */
  startIteration?: number;
  /** Debug mode: write raw ACP events to NDJSON */
  debug?: boolean;
  /** Streaming callback for agent text chunks */
  onOutput?: (chunk: string) => void;
}

export interface LoopDeps {
  runIteration?: (options: AcpIterationOptions) => Promise<AcpIterationResult>;
  resolveAgent?: (agentId: string) => Promise<{ bin: string; args: string[] }>;
}

const DEFAULT_MAX_ITERATIONS = 10;
const DEFAULT_SENTINEL = ":::LOOPER_DONE:::";

export async function loop(
  options: LoopOptions,
  deps: LoopDeps = {},
): Promise<LoopResult> {
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const sentinel = options.sentinel ?? DEFAULT_SENTINEL;
  const vars = options.vars ?? {};
  const startIteration = options.startIteration ?? 1;
  const sessionId = options.sessionId ?? randomUUID();
  const debug = options.debug ?? false;
  const cwd = options.cwd;

  // Build spawn command
  let command: { bin: string; args: string[] };
  if (options.agentCommand) {
    command = tokenizeCommand(options.agentCommand);
  } else if (options.agent && deps.resolveAgent) {
    command = await deps.resolveAgent(options.agent);
  } else if (options.agent) {
    throw new Error("resolveAgent dependency required when using agent option");
  } else {
    throw new Error("Either agentCommand or agent must be provided");
  }

  const iterations: IterationResult[] = [];
  let stopReason: StopReason = "max_iterations";

  const run = deps.runIteration ?? runAcpIteration;

  // Session setup
  let session: Session;
  const sessionDir = getSessionDir(cwd, sessionId);

  if (options.sessionId) {
    // Resume existing session
    session = await readSession(sessionDir);
    session.state = "active";
    iterations.push(...session.iterations);
    await writeSessionState(sessionDir, "active");
  } else {
    // New session
    session = {
      id: sessionId,
      state: "active",
      createdAt: new Date().toISOString(),
      prompt: options.prompt,
      agent: options.agent,
      agentCommand: options.agentCommand,
      maxIterations,
      sentinel,
      vars,
      cwd,
      debug,
      iterations: [],
    };
    await createSession(session);
  }

  // Collect raw ACP events for debug mode
  const events: unknown[] = [];

  for (let i = startIteration; i <= maxIterations; i++) {
    if (options.signal?.aborted) {
      stopReason = "aborted";
      break;
    }

    const promptVars = {
      ITERATION: String(i),
      MAX_ITERATIONS: String(maxIterations),
      SESSION_ID: sessionId,
      ...vars,
    };
    const prompt = substitute(options.prompt, promptVars);

    const startedAt = new Date().toISOString();
    const iterationStartTime = Date.now();

    try {
      const iterationResult = await run({
        prompt,
        cwd,
        command,
        onOutput: options.onOutput,
        onSessionUpdate: debug
          ? (notification) => events.push(notification)
          : undefined,
        signal: options.signal,
      });

      const durationMs =
        iterationResult.durationMs ?? Date.now() - iterationStartTime;

      const result: IterationResult = {
        number: i,
        stopReason: iterationResult.stopReason,
        sentinelDetected: false,
        text: iterationResult.text,
        startedAt: iterationResult.startedAt ?? startedAt,
        durationMs,
        toolCalls: [],
        error: null,
      };

      // Abort
      if (
        options.signal?.aborted ||
        iterationResult.stopReason === "cancelled"
      ) {
        iterations.push(result);
        session.iterations.push(result);
        await appendSessionLog(sessionDir, result);
        await writeSessionJson(sessionDir, session);
        if (debug && events.length > 0) {
          await appendSessionEvents(
            sessionDir,
            events.splice(0, events.length),
          );
        }
        stopReason = "aborted";
        break;
      }

      // Actual iteration error (spawn or connection failure)
      if (iterationResult.error) {
        result.error = {
          code: "ITERATION_ERROR",
          message: iterationResult.error.message,
          raw: iterationResult.error.stack ?? iterationResult.error.message,
        };
        iterations.push(result);
        session.iterations.push(result);
        await appendSessionLog(sessionDir, result);
        await writeSessionJson(sessionDir, session);
        if (debug && events.length > 0) {
          await appendSessionEvents(
            sessionDir,
            events.splice(0, events.length),
          );
        }
        stopReason = "error";
        break;
      }

      // Non-end_turn stopReason is an error
      if (iterationResult.stopReason !== "end_turn") {
        result.error = {
          code: "NON_END_TURN",
          message: `Agent stopped with reason: ${iterationResult.stopReason}`,
          raw: iterationResult.stopReason,
        };
        iterations.push(result);
        session.iterations.push(result);
        await appendSessionLog(sessionDir, result);
        await writeSessionJson(sessionDir, session);
        if (debug && events.length > 0) {
          await appendSessionEvents(
            sessionDir,
            events.splice(0, events.length),
          );
        }
        stopReason = "error";
        break;
      }

      // Check sentinel
      if (iterationResult.text.includes(sentinel)) {
        result.sentinelDetected = true;
        iterations.push(result);
        session.iterations.push(result);
        await appendSessionLog(sessionDir, result);
        await writeSessionJson(sessionDir, session);
        if (debug && events.length > 0) {
          await appendSessionEvents(
            sessionDir,
            events.splice(0, events.length),
          );
        }
        stopReason = "sentinel";
        break;
      }

      iterations.push(result);
      session.iterations.push(result);
      await appendSessionLog(sessionDir, result);
      await writeSessionJson(sessionDir, session);
      if (debug && events.length > 0) {
        await appendSessionEvents(sessionDir, events.splice(0, events.length));
      }
    } catch (error) {
      const durationMs = Date.now() - iterationStartTime;
      const errorResult: IterationResult = {
        number: i,
        stopReason: null,
        sentinelDetected: false,
        text: "",
        startedAt,
        durationMs,
        toolCalls: [],
        error: {
          code: "EXCEPTION",
          message: error instanceof Error ? error.message : String(error),
          raw: String(error),
        },
      };
      iterations.push(errorResult);
      session.iterations.push(errorResult);
      await appendSessionLog(sessionDir, errorResult);
      await writeSessionJson(sessionDir, session);
      if (debug && events.length > 0) {
        await appendSessionEvents(sessionDir, events.splice(0, events.length));
      }
      stopReason = "error";
      break;
    }
  }

  // Final state update
  const finalState: Session["state"] =
    stopReason === "aborted" || stopReason === "error"
      ? "interrupted"
      : "completed";
  session.state = finalState;
  session.completedAt = new Date().toISOString();
  await writeSessionState(sessionDir, finalState);
  await writeSessionJson(sessionDir, session);

  return { iterations, stopReason };
}

export interface ResumeOptions {
  cwd: string;
  sessionId: string;
  onOutput?: (chunk: string) => void;
  signal?: AbortSignal;
}

export async function resume(
  options: ResumeOptions,
  deps: LoopDeps = {},
): Promise<LoopResult> {
  const sessionDir = getSessionDir(options.cwd, options.sessionId);
  const session = await readSession(sessionDir);

  return loop(
    {
      prompt: session.prompt,
      cwd: session.cwd,
      agent: session.agent,
      agentCommand: session.agentCommand,
      maxIterations: session.maxIterations,
      sentinel: session.sentinel,
      vars: session.vars,
      sessionId: session.id,
      startIteration: session.iterations.length + 1,
      debug: session.debug,
      onOutput: options.onOutput,
      signal: options.signal,
    },
    deps,
  );
}
