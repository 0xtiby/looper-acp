# @0xtiby/looper-acp

ACP-native Ralph Loop engine — stateless agent iteration via the [Agent Client Protocol](https://agentclientprotocol.com).

## Status

🚧 **Under construction** — see the [PRD](https://github.com/0xtiby/looper-acp/issues/1) and [open issues](https://github.com/0xtiby/looper-acp/issues).

## What is Looper ACP?

A standalone engine that implements the Ralph Loop over ACP:

1. Discover ACP-compatible agents from the [ACP Registry](https://agentclientprotocol.com/get-started/registry).
2. Spawn an agent as a subprocess, drive it through the ACP protocol.
3. The agent performs one prompt turn, streams text, and returns a `stopReason`.
4. Looper ACP checks for a sentinel string. If not found, it kills the process and spawns a fresh agent for the next iteration.
5. Repeat until sentinel, max iterations, or error.

Each iteration is **stateless** — a completely fresh agent process with no shared session state. The filesystem is the only memory between turns.

## Install

```bash
pnpm add @0xtiby/looper-acp
# or: npm install @0xtiby/looper-acp
```

## Usage

### CLI (coming soon)

```bash
looper-acp init
looper-acp run -p "Refactor auth. Emit :::LOOPER_DONE::: when finished." --agent claude-agent
```

### Library (coming soon)

```ts
import { loop } from "@0xtiby/looper-acp";

const result = await loop({
  agent: "claude-agent",
  prompt: "Fix the failing tests. Emit :::LOOPER_DONE::: when finished.",
  cwd: process.cwd(),
  maxIterations: 5,
});
```

## License

MIT
