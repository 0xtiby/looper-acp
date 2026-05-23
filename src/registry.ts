import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

/**
 * ACP Registry fetch, cache, and refresh.
 *
 * Cache location: ~/.looper-acp/registry.json
 * Source: https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json
 */

export const REGISTRY_URL =
  "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";

export function getCachePath(): string {
  return join(homedir(), ".looper-acp", "registry.json");
}

const RegistryPackageDistributionSchema = z
  .object({
    package: z.string().min(1),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

const RegistryAgentDistributionSchema = z
  .object({
    npx: RegistryPackageDistributionSchema.optional(),
    uvx: RegistryPackageDistributionSchema.optional(),
    binary: z
      .record(
        z.string(),
        z.object({
          archive: z.string(),
          cmd: z.string(),
          args: z.array(z.string()).optional(),
        }),
      )
      .optional(),
  })
  .passthrough();

const RegistryAgentSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    version: z.string().optional(),
    description: z.string().optional(),
    distribution: RegistryAgentDistributionSchema,
  })
  .passthrough();

export const AcpRegistrySchema = z
  .object({
    version: z.string().optional(),
    agents: z.array(RegistryAgentSchema),
  })
  .passthrough();

export type AcpRegistry = z.infer<typeof AcpRegistrySchema>;
export type AcpRegistryAgent = z.infer<typeof RegistryAgentSchema>;

export async function fetchRegistry(
  url: string = REGISTRY_URL,
  fetchJson?: (url: string) => Promise<unknown>,
): Promise<AcpRegistry> {
  const payload = fetchJson
    ? await fetchJson(url)
    : await fetch(url).then((r) => r.json());
  return AcpRegistrySchema.parse(payload);
}

export async function readCachedRegistry(
  cachePath: string = getCachePath(),
): Promise<AcpRegistry | null> {
  try {
    const raw = await readFile(cachePath, "utf8");
    return AcpRegistrySchema.parse(JSON.parse(raw));
  } catch (err) {
    if (isFileNotFound(err)) return null;
    throw err;
  }
}

export async function writeCachedRegistry(
  registry: AcpRegistry,
  cachePath: string = getCachePath(),
): Promise<void> {
  await mkdir(join(homedir(), ".looper-acp"), { recursive: true });
  await writeFile(cachePath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
}

export async function fetchAndCacheRegistry(
  url: string = REGISTRY_URL,
  cachePath: string = getCachePath(),
  fetchJson?: (url: string) => Promise<unknown>,
): Promise<AcpRegistry> {
  const registry = await fetchRegistry(url, fetchJson);
  await writeCachedRegistry(registry, cachePath);
  return registry;
}

function isFileNotFound(err: unknown): boolean {
  return (
    err instanceof Error &&
    "code" in err &&
    (err as { code: string }).code === "ENOENT"
  );
}
