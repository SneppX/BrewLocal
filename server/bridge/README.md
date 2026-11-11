# Local bridge security boundary

This module is a transport-neutral receiver and dispatcher for signed requests from the separate BrewPilot cloud service.

## Implemented

- Ed25519 signature verification over canonical JSON.
- Exact envelope schema and argument-digest validation.
- 60-second maximum request lifetime and bounded clock skew.
- Per-device nonce replay protection with a bounded in-memory store.
- Exact device identity check.
- Independent local permission evaluation.
- Fresh local confirmation for external, destructive and privileged risk classes.
- Bounded adapter result serialization and redacted audit metadata.

## Not implemented

- No outbound WebSocket, SSE, polling or Sites-specific transport.
- No device pairing or account enrollment.
- No persistent nonce database.
- No native desktop-control, process-management or terminal-execution adapter.
- The bridge dispatcher is not yet wired into the stdio MCP process.

Do not expose this module through an unauthenticated local HTTP listener. The eventual transport must be initiated by the local agent and must deliver only signed, short-lived requests to this dispatcher.

## Request contract

The envelope matches `packages/protocol/src/envelope.ts` in the separate BrewPilot repository. Keep canonical serialization, digest rules, timestamp units, field names and signature encoding compatible.

## Local policy

A valid cloud signature does not authorize an operation. The local `PermissionManager` is independently evaluated for every request. Cloud-side approval cannot override a local deny. The dispatcher refuses unsupported capability/operation pairs and fails closed when audit recording is unavailable before execution.
