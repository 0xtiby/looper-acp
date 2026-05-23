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

import {
  type AcpIterationOptions,
  type AcpIterationResult,
  runAcpIteration,
} from "./acp-client.js";
import { tokenizeCommand } from "./agent-resolver.js";
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

export async function loop(
  options: LoopOptions,
  deps: LoopDeps = {},
): Promise<LoopResult> {
  const maxIterations = options.maxIterations ?? 10;
  const sentinel = options.sentinel ?? ":::LOOPER_DONE:::";
  const vars = options.vars ?? {};
  const startIteration = options.startIteration ?? 1;

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

  for (let i = startIteration; i <= maxIterations; i++) {
    if (options.signal?.aborted) {
      stopReason = "aborted";
      break;
    }

    const promptVars = {
      ITERATION: String(i),
      MAX_ITERATIONS: String(maxIterations),
      SESSION_ID: options.sessionId ?? "",
      ...vars,
    };
    const prompt = substitute(options.prompt, promptVars);

    const startedAt = new Date().toISOString();
    const iterationStartTime = Date.now();

    try {
      const iterationResult = await run({
        prompt,
        cwd: options.cwd,
        command,
        onOutput: options.onOutput,
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
        stopReason = "error";
        break;
      }

      // Check sentinel
      if (iterationResult.text.includes(sentinel)) {
        result.sentinelDetected = true;
        iterations.push(result);
        stopReason = "sentinel";
        break;
      }

      iterations.push(result);
    } catch (error) {
      const durationMs = Date.now() - iterationStartTime;
      iterations.push({
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
      });
      stopReason = "error";
      break;
    }
  }

  return { iterations, stopReason };
}
