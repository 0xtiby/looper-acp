#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { Command } from "commander";
import { resolveAgent } from "./agent-resolver.js";
import { loadConfig, resolveConfig, writeDefaultConfig } from "./config.js";
import { resume as resumeLoop } from "./index.js";
import {
  type AcpRegistry,
  type AcpRegistryAgent,
  fetchAndCacheRegistry,
  readCachedRegistry,
} from "./registry.js";
import { listInterruptedSessions } from "./session.js";

const program = new Command();

program
  .name("looper-acp")
  .description("ACP-native Ralph Loop engine")
  .version("0.0.0-development");

program
  .command("init")
  .description("Scaffold .looper-acp/config.json and fetch the ACP registry")
  .action(async () => {
    await init({ cwd: process.cwd() });
  });

program
  .command("config")
  .description("Print resolved config")
  .action(async () => {
    await config({ cwd: process.cwd() });
  });

program
  .command("agents")
  .description("List available ACP agents from the registry")
  .option("--refresh", "Force-refetch the registry from CDN")
  .action(async (opts: { refresh?: boolean }) => {
    await agents({ refresh: opts.refresh });
  });

program
  .command("run")
  .description("Run a Ralph Loop with a prompt")
  .requiredOption("-p, --prompt <value>", "Inline prompt or path to a file")
  .option("--prompt-stdin", "Read prompt from stdin")
  .option("--agent <id>", "Registry agent ID")
  .option("--agent-command <cmd>", "Raw spawn command for the agent")
  .option("--max-iterations <n>", "Cap the number of iterations")
  .option("--sentinel <string>", "String the agent must emit to stop the loop")
  .option("--cwd <path>", "Working directory for the spawned agent")
  .option(
    "--var <pair>",
    "Template variable KEY=VALUE (repeatable)",
    collectVars,
    {},
  )
  .option("--debug", "Write raw ACP events to NDJSON transcript")
  .action((_opts) => {
    // TODO(#7): implement run
    console.error("run not yet implemented");
    process.exit(1);
  });

program
  .command("resume [session-id]")
  .description("Resume an interrupted session")
  .action(async (sessionId?: string) => {
    await resume({ cwd: process.cwd(), sessionId });
  });

const isMain =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  program.parse();
}

function collectVars(
  value: string,
  previous: Record<string, string>,
): Record<string, string> {
  const idx = value.indexOf("=");
  if (idx === -1) throw new Error(`Invalid var: ${value} (expected KEY=VALUE)`);
  return { ...previous, [value.slice(0, idx)]: value.slice(idx + 1) };
}

/* ─── Command handlers (exported for tests) ─── */

export interface InitDeps {
  writeDefaultConfig: typeof writeDefaultConfig;
  fetchAndCacheRegistry: typeof fetchAndCacheRegistry;
}

export async function init(
  options: { cwd: string },
  deps: InitDeps = { writeDefaultConfig, fetchAndCacheRegistry },
): Promise<void> {
  try {
    const configPath = await deps.writeDefaultConfig(options.cwd);
    console.log(`Created ${configPath}`);
  } catch (err) {
    if (err instanceof Error && /exists/i.test(err.message)) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  const registry = await deps.fetchAndCacheRegistry();
  console.log(`Fetched ${registry.agents.length} agents from the ACP registry`);
}

export interface ConfigDeps {
  loadConfig: typeof loadConfig;
  resolveConfig: typeof resolveConfig;
}

export async function config(
  options: { cwd: string },
  deps: ConfigDeps = { loadConfig, resolveConfig },
): Promise<void> {
  const fileConfig = await deps.loadConfig(options.cwd);
  const resolved = deps.resolveConfig(fileConfig);
  console.log(JSON.stringify(resolved, null, 2));
}

export interface AgentsDeps {
  fetchAndCacheRegistry: typeof fetchAndCacheRegistry;
  readCachedRegistry: typeof readCachedRegistry;
}

function getDistributionType(agent: AcpRegistryAgent): string {
  if (agent.distribution.npx) return "npx";
  if (agent.distribution.uvx) return "uvx";
  if (agent.distribution.binary) return "binary";
  return "unknown";
}

export async function agents(
  options: { refresh?: boolean },
  deps: AgentsDeps = { fetchAndCacheRegistry, readCachedRegistry },
): Promise<void> {
  let registry: AcpRegistry;

  if (options.refresh) {
    registry = await deps.fetchAndCacheRegistry();
    console.log(
      `Fetched ${registry.agents.length} agents from the ACP registry`,
    );
  } else {
    const cached = await deps.readCachedRegistry();
    if (!cached) {
      console.error(
        "No registry cache found. Run `looper-acp init` or `looper-acp agents --refresh`.",
      );
      process.exit(1);
    }
    registry = cached;
  }

  if (registry.agents.length === 0) {
    console.log("No agents in registry.");
    return;
  }

  const rows = registry.agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    version: agent.version ?? "-",
    distribution: getDistributionType(agent),
  }));

  const idWidth = Math.max(2, ...rows.map((r) => r.id.length)) + 2;
  const nameWidth = Math.max(4, ...rows.map((r) => r.name.length)) + 2;
  const versionWidth = Math.max(7, ...rows.map((r) => r.version.length)) + 2;

  console.log(
    "ID".padEnd(idWidth) +
      "NAME".padEnd(nameWidth) +
      "VERSION".padEnd(versionWidth) +
      "DISTRIBUTION",
  );

  for (const row of rows) {
    console.log(
      row.id.padEnd(idWidth) +
        row.name.padEnd(nameWidth) +
        row.version.padEnd(versionWidth) +
        row.distribution,
    );
  }
}

export interface ResumeDeps {
  listInterruptedSessions: typeof listInterruptedSessions;
  resumeLoop: typeof resumeLoop;
  readCachedRegistry: typeof readCachedRegistry;
  resolveAgent: typeof resolveAgent;
}

export async function resume(
  options: { cwd: string; sessionId?: string },
  deps: ResumeDeps = {
    listInterruptedSessions,
    resumeLoop,
    readCachedRegistry,
    resolveAgent,
  },
): Promise<void> {
  if (!options.sessionId) {
    const sessions = await deps.listInterruptedSessions(options.cwd);
    if (sessions.length === 0) {
      console.log("No interrupted sessions found.");
      return;
    }
    for (const session of sessions) {
      const iterCount = session.iterations.length;
      console.log(
        `${session.id}  prompt: "${session.prompt}"  iterations: ${iterCount}`,
      );
    }
    return;
  }

  const resolveAgentDep = async (agentId: string) => {
    const registry = await deps.readCachedRegistry();
    if (!registry) {
      throw new Error(
        "No registry cache found. Run `looper-acp init` or `looper-acp agents --refresh`.",
      );
    }
    const cmd = deps.resolveAgent(agentId, registry);
    return { bin: cmd.bin, args: cmd.args };
  };

  const result = await deps.resumeLoop(
    {
      cwd: options.cwd,
      sessionId: options.sessionId,
      onOutput: (chunk) => process.stdout.write(chunk),
    },
    { resolveAgent: resolveAgentDep },
  );

  console.log(`Session ${options.sessionId} resumed.`);
  console.log(`Stop reason: ${result.stopReason}`);
  console.log(`Total iterations: ${result.iterations.length}`);
}
