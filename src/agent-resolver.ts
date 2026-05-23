import type { AcpRegistry, AcpRegistryAgent } from "./registry.js";

/**
 * Resolve a registry agent ID to a spawnable binary + args array.
 *
 * Supports distribution types:
 *   - npx:  { package: "pkg@1.0.0", args: [] }
 *   - uvx:  { package: "pkg", args: [] }
 *   - binary: { "darwin-aarch64": { archive, cmd, args }, ... }
 *
 * Also handles --agent-command tokenization.
 */

export interface SpawnCommand {
  bin: string;
  args: string[];
  env?: Record<string, string>;
}

export class MissingRegistryAgentError extends Error {
  constructor(agentId: string) {
    super(`ACP Registry Agent "${agentId}" was not found.`);
    this.name = "MissingRegistryAgentError";
  }
}

export class UnsupportedRegistryDistributionError extends Error {
  constructor(agentId: string) {
    super(
      `ACP Registry Agent "${agentId}" does not provide a supported distribution.`,
    );
    this.name = "UnsupportedRegistryDistributionError";
  }
}

export function resolveAgent(
  agentId: string,
  registry: AcpRegistry,
): SpawnCommand {
  const agent = registry.agents.find((a) => a.id === agentId);
  if (!agent) {
    throw new MissingRegistryAgentError(agentId);
  }
  return resolveDistribution(agent);
}

function resolveDistribution(agent: AcpRegistryAgent): SpawnCommand {
  const npx = agent.distribution.npx;
  if (npx) {
    return {
      bin: "npx",
      args: ["-y", npx.package, ...(npx.args ?? [])],
      env: npx.env,
    };
  }

  const uvx = agent.distribution.uvx;
  if (uvx) {
    return {
      bin: "uvx",
      args: [uvx.package, ...(uvx.args ?? [])],
      env: uvx.env,
    };
  }

  if (agent.distribution.binary) {
    throw new UnsupportedRegistryDistributionError(agent.id);
  }

  throw new UnsupportedRegistryDistributionError(agent.id);
}

export function tokenizeCommand(command: string): SpawnCommand {
  const tokens: string[] = [];
  let current = "";
  let inQuotes: '"' | "'" | null = null;

  for (let i = 0; i < command.length; i++) {
    const char = command.charAt(i);

    if (inQuotes) {
      if (char === inQuotes) {
        inQuotes = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inQuotes = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  if (tokens.length === 0) {
    throw new Error("Command string is empty");
  }

  const [bin, ...args] = tokens;
  if (!bin) {
    throw new Error("Command string is empty");
  }
  return { bin, args };
}
