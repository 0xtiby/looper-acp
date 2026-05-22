/**
 * ACP Client implementation for Looper ACP.
 *
 * Implements the ACP Client interface:
 *   - readTextFile / writeTextFile: pass-through to fs in cwd
 *   - requestPermission: auto-approve first option
 *   - sessionUpdate: stream text chunks to onOutput, collect transcript
 */

// TODO(#2): implement Client interface using @agentclientprotocol/sdk
