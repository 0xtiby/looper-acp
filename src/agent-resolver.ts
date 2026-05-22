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

// TODO(#3): implement registry lookup and command tokenization
