import { describe, expect, it } from "vitest";
import {
  MissingRegistryAgentError,
  resolveAgent,
  tokenizeCommand,
  UnsupportedRegistryDistributionError,
} from "./agent-resolver.js";

describe("resolveAgent", () => {
  it("resolves an npx distribution to a spawn command", () => {
    const registry = {
      version: "1",
      agents: [
        {
          id: "claude-acp",
          name: "Claude Agent",
          distribution: {
            npx: {
              package: "@agentclientprotocol/claude-agent-acp@0.37.0",
              args: ["--debug"],
              env: { LOG: "1" },
            },
          },
        },
      ],
    };

    const cmd = resolveAgent("claude-acp", registry);
    expect(cmd).toEqual({
      bin: "npx",
      args: ["-y", "@agentclientprotocol/claude-agent-acp@0.37.0", "--debug"],
      env: { LOG: "1" },
    });
  });

  it("resolves a uvx distribution to a spawn command", () => {
    const registry = {
      version: "1",
      agents: [
        {
          id: "python-acp",
          name: "Python Agent",
          distribution: {
            uvx: {
              package: "python-agent",
              args: ["--verbose"],
            },
          },
        },
      ],
    };

    const cmd = resolveAgent("python-acp", registry);
    expect(cmd).toEqual({
      bin: "uvx",
      args: ["python-agent", "--verbose"],
    });
  });

  it("throws when the agent ID is not found in the registry", () => {
    const registry = { version: "1", agents: [] };
    expect(() => resolveAgent("missing", registry)).toThrow(
      MissingRegistryAgentError,
    );
  });

  it("throws when the distribution type is not supported", () => {
    const registry = {
      version: "1",
      agents: [
        {
          id: "binary-only",
          name: "Binary Agent",
          distribution: {
            binary: {
              "darwin-aarch64": { archive: "agent.zip", cmd: "agent" },
            },
          },
        },
      ],
    };
    expect(() => resolveAgent("binary-only", registry)).toThrow(
      UnsupportedRegistryDistributionError,
    );
  });

  it("throws when no distribution is present", () => {
    const registry = {
      version: "1",
      agents: [
        {
          id: "no-dist",
          name: "No Dist Agent",
          distribution: {},
        },
      ],
    };
    expect(() => resolveAgent("no-dist", registry)).toThrow(
      UnsupportedRegistryDistributionError,
    );
  });
});

describe("tokenizeCommand", () => {
  it("splits a simple command into binary and args", () => {
    expect(tokenizeCommand("npx -y some-pkg")).toEqual({
      bin: "npx",
      args: ["-y", "some-pkg"],
    });
  });

  it("handles double-quoted arguments", () => {
    expect(tokenizeCommand('node -e "console.log(1)"')).toEqual({
      bin: "node",
      args: ["-e", "console.log(1)"],
    });
  });

  it("handles single-quoted arguments", () => {
    expect(tokenizeCommand("echo 'hello world'")).toEqual({
      bin: "echo",
      args: ["hello world"],
    });
  });

  it("handles mixed quotes and multiple spaces", () => {
    expect(tokenizeCommand('node   -e "hello world"   --flag')).toEqual({
      bin: "node",
      args: ["-e", "hello world", "--flag"],
    });
  });

  it("handles an empty args tail", () => {
    expect(tokenizeCommand("claude")).toEqual({
      bin: "claude",
      args: [],
    });
  });

  it("throws on an empty command string", () => {
    expect(() => tokenizeCommand("")).toThrow();
  });

  it("handles only whitespace by throwing", () => {
    expect(() => tokenizeCommand("   ")).toThrow();
  });
});
