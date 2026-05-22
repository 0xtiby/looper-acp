/**
 * Session persistence: metadata JSON, text transcript log, optional NDJSON events.
 *
 * Session files live under .looper-acp/sessions/<uuid>/
 *   <uuid>.json  — metadata and iteration results
 *   <uuid>.log   — human-readable text transcript
 *   <uuid>.events.ndjson  — raw ACP events (debug mode only)
 */

// TODO(#6): implement session I/O and resume logic
