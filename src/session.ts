/**
 * Session persistence: metadata JSON, text transcript log, optional NDJSON events.
 *
 * Session files live under .looper-acp/sessions/<uuid>/
 *   state              — simple state file (active | completed | interrupted)
 *   <uuid>.json        — metadata and iteration results
 *   <uuid>.log         — human-readable text transcript
 *   <uuid>.events.ndjson  — raw ACP events (debug mode only)
 */

import {
  appendFile,
  mkdir,
  readdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

export type SessionState = "active" | "completed" | "interrupted";

export interface SessionIterationResult {
  number: number;
  stopReason: string | null;
  sentinelDetected: boolean;
  text: string;
  startedAt: string;
  durationMs: number;
  toolCalls: { name: string; status: string }[];
  error: { code: string; message: string; raw: string } | null;
}

export interface Session {
  id: string;
  state: SessionState;
  createdAt: string;
  completedAt?: string;
  prompt: string;
  agent?: string;
  agentCommand?: string;
  maxIterations: number;
  sentinel: string;
  vars: Record<string, string>;
  cwd: string;
  debug: boolean;
  iterations: SessionIterationResult[];
}

export function getSessionsDir(cwd: string): string {
  return join(cwd, ".looper-acp", "sessions");
}

export function getSessionDir(cwd: string, sessionId: string): string {
  return join(getSessionsDir(cwd), sessionId);
}

export async function createSession(session: Session): Promise<void> {
  const sessionDir = getSessionDir(session.cwd, session.id);
  await mkdir(sessionDir, { recursive: true });
  await writeSessionJson(sessionDir, session);
  await writeSessionState(sessionDir, session.state);
}

export async function writeSessionJson(
  sessionDir: string,
  session: Session,
): Promise<void> {
  const file = join(sessionDir, `${session.id}.json`);
  await writeFile(file, JSON.stringify(session, null, 2), "utf8");
}

export async function appendSessionLog(
  sessionDir: string,
  iteration: SessionIterationResult,
): Promise<void> {
  const sessionId = basename(sessionDir);
  const file = join(sessionDir, `${sessionId}.log`);
  const marker = `--- ITERATION ${iteration.number} [${iteration.startedAt}] ---\n`;
  const body = iteration.text ? `${iteration.text}\n` : "";
  await appendFile(file, marker + body, "utf8");
}

export async function appendSessionEvents(
  sessionDir: string,
  events: unknown[],
): Promise<void> {
  if (events.length === 0) return;
  const sessionId = basename(sessionDir);
  const file = join(sessionDir, `${sessionId}.events.ndjson`);
  const lines = `${events.map((e) => JSON.stringify(e)).join("\n")}\n`;
  await appendFile(file, lines, "utf8");
}

export async function writeSessionState(
  sessionDir: string,
  state: SessionState,
): Promise<void> {
  const file = join(sessionDir, "state");
  await writeFile(file, state, "utf8");
}

export async function readSession(sessionDir: string): Promise<Session> {
  const sessionId = basename(sessionDir);
  const file = join(sessionDir, `${sessionId}.json`);
  const raw = await readFile(file, "utf8");
  return JSON.parse(raw) as Session;
}

export async function listSessions(
  cwd: string,
): Promise<{ id: string; state: SessionState; dir: string }[]> {
  const sessionsDir = getSessionsDir(cwd);
  const entries: { id: string; state: SessionState; dir: string }[] = [];

  try {
    const ids = await readdir(sessionsDir);
    for (const id of ids) {
      const dir = join(sessionsDir, id);
      try {
        const stateRaw = await readFile(join(dir, "state"), "utf8");
        const state = stateRaw.trim() as SessionState;
        entries.push({ id, state, dir });
      } catch {
        // ignore malformed session dirs
      }
    }
  } catch {
    // no sessions dir yet
  }

  return entries;
}

export async function listInterruptedSessions(cwd: string): Promise<Session[]> {
  const sessions = await listSessions(cwd);
  const interrupted = sessions.filter((s) => s.state === "interrupted");
  const results: Session[] = [];
  for (const s of interrupted) {
    try {
      const session = await readSession(s.dir);
      results.push(session);
    } catch {
      // ignore unreadable sessions
    }
  }
  return results;
}

function basename(p: string): string {
  const idx = p.lastIndexOf("/");
  return idx >= 0 ? p.slice(idx + 1) : p;
}
