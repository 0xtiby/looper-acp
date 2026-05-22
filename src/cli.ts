#!/usr/bin/env node

import { Command } from "commander";

const program = new Command();

program.name("looper-acp").description("ACP-native Ralph Loop engine").version("0.0.0-development");

program
  .command("init")
  .description("Scaffold .looper-acp/config.json and fetch the ACP registry")
  .action(() => {
    // TODO(#4): implement init
    console.error("init not yet implemented");
    process.exit(1);
  });

program
  .command("config")
  .description("Print resolved config")
  .action(() => {
    // TODO(#4): implement config
    console.error("config not yet implemented");
    process.exit(1);
  });

program
  .command("agents")
  .description("List available ACP agents from the registry")
  .option("--refresh", "Force-refetch the registry from CDN")
  .action((_opts) => {
    // TODO(#4): implement agents
    console.error("agents not yet implemented");
    process.exit(1);
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
  .option("--var <pair>", "Template variable KEY=VALUE (repeatable)", collectVars, {})
  .option("--debug", "Write raw ACP events to NDJSON transcript")
  .action((_opts) => {
    // TODO(#7): implement run
    console.error("run not yet implemented");
    process.exit(1);
  });

program
  .command("resume [session-id]")
  .description("Resume an interrupted session")
  .action((_sessionId) => {
    // TODO(#7): implement resume
    console.error("resume not yet implemented");
    process.exit(1);
  });

program.parse();

function collectVars(value: string, previous: Record<string, string>): Record<string, string> {
  const idx = value.indexOf("=");
  if (idx === -1) throw new Error(`Invalid var: ${value} (expected KEY=VALUE)`);
  return { ...previous, [value.slice(0, idx)]: value.slice(idx + 1) };
}
