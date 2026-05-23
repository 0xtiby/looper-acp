import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

/**
 * Config loader for .looper-acp/config.json.
 *
 * Precedence (higher wins):
 *   CLI flags > config file > built-in defaults.
 */

export const configSchema = z.object({
  agent: z.string().optional(),
  agentCommand: z.string().optional(),
  maxIterations: z.number().int().positive().optional(),
  sentinel: z.string().optional(),
  vars: z.record(z.string(), z.string()).optional(),
  debug: z.boolean().optional(),
});

export type Config = z.infer<typeof configSchema>;

export interface ResolvedConfig {
  agent: string | undefined;
  agentCommand: string | undefined;
  maxIterations: number;
  sentinel: string;
  vars: Record<string, string>;
  debug: boolean;
}

export const DEFAULT_CONFIG: ResolvedConfig = {
  agent: undefined,
  agentCommand: undefined,
  maxIterations: 10,
  sentinel: ":::LOOPER_DONE:::",
  vars: {},
  debug: false,
};

export interface CliOverrides {
  agent?: string;
  agentCommand?: string;
  maxIterations?: number;
  sentinel?: string;
  vars?: Record<string, string>;
  debug?: boolean;
}

export function resolveConfig(
  fileConfig: Config | null,
  cliOverrides: CliOverrides = {},
): ResolvedConfig {
  const file = fileConfig ?? {};

  const merged: ResolvedConfig = {
    agent: cliOverrides.agent ?? file.agent ?? DEFAULT_CONFIG.agent,
    agentCommand:
      cliOverrides.agentCommand ??
      file.agentCommand ??
      DEFAULT_CONFIG.agentCommand,
    maxIterations:
      cliOverrides.maxIterations ??
      file.maxIterations ??
      DEFAULT_CONFIG.maxIterations,
    sentinel: cliOverrides.sentinel ?? file.sentinel ?? DEFAULT_CONFIG.sentinel,
    vars: { ...(file.vars ?? {}), ...(cliOverrides.vars ?? {}) },
    debug: cliOverrides.debug ?? file.debug ?? DEFAULT_CONFIG.debug,
  };

  if (merged.agent && merged.agentCommand) {
    merged.agent = undefined;
  }

  return merged;
}

export async function loadConfig(cwd: string): Promise<Config | null> {
  const file = path.join(cwd, ".looper-acp", "config.json");
  try {
    const raw = await readFile(file, "utf8");
    return configSchema.parse(JSON.parse(raw));
  } catch (err) {
    if (isFileNotFound(err)) return null;
    throw err;
  }
}

export async function writeDefaultConfig(cwd: string): Promise<string> {
  const dir = path.join(cwd, ".looper-acp");
  const file = path.join(dir, "config.json");
  await mkdir(dir, { recursive: true });
  const body = `${JSON.stringify(
    {
      maxIterations: DEFAULT_CONFIG.maxIterations,
      sentinel: DEFAULT_CONFIG.sentinel,
      vars: DEFAULT_CONFIG.vars,
    },
    null,
    2,
  )}\n`;
  try {
    await writeFile(file, body, { encoding: "utf8", flag: "wx" });
  } catch (err) {
    if (isFileExists(err)) {
      throw new Error(`Config file already exists at ${file}`);
    }
    throw err;
  }
  return file;
}

function isFileNotFound(err: unknown): boolean {
  return (
    err instanceof Error &&
    "code" in err &&
    (err as { code: string }).code === "ENOENT"
  );
}

function isFileExists(err: unknown): boolean {
  return (
    err instanceof Error &&
    "code" in err &&
    (err as { code: string }).code === "EEXIST"
  );
}
