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
  maxIterations: z.number().optional(),
  sentinel: z.string().optional(),
  vars: z.record(z.string(), z.string()).optional(),
  debug: z.boolean().optional(),
});

export type Config = z.infer<typeof configSchema>;

// TODO(#3): implement config loading with precedence, file resolution, and validation
