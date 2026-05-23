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
export { createLooperAcpClient, runAcpHelloWorld } from "./acp-client.js";

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
  /** Optional custom agent resolver */
  resolveAgent?: (id: string) => Promise<{ bin: string; args: string[] }>;
}

export type LoopDeps = Record<never, never>;

export async function loop(
  _options: LoopOptions,
  _deps: LoopDeps = {},
): Promise<LoopResult> {
  // TODO(#5): Implement the Ralph Loop over ACP.
  throw new Error("loop() not yet implemented");
}
