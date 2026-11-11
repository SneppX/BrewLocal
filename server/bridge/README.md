# Local bridge security boundary

This module is a transport-neutral receiver and dispatcher for signed requests from the separate BrewPilot cloud service.

## Implemented

- Account-scoped Ed25519 device identity generation and challenge signing.
- Private-key persistence through native OS credential stores: Windows Credential Manager, macOS Keychain, and Linux Secret Service only. No plaintext fallback is allowed.
- HTTPS-only cloud pairing initiation through `device-pairing-client.mjs`; loopback HTTP is allowed only for local development.
- Pairing initiation sends the device ID and public key only. The private key remains in the OS credential store.
- Ed25519 signature verification over canonical JSON.
- Exact envelope schema and argument-digest validation.
- 60-second maximum request lifetime and bounded clock skew.
- Per-device nonce replay protection with a bounded in-memory store.
- Exact device identity check.
- Independent local permission evaluation.
- Fresh local confirmation for external, destructive and privileged risk classes.
- Bounded adapter result serialization and redacted audit metadata.

## Not yet implemented

- User-authorized pairing completion flow from the assistant-facing MCP tool into a fully connected local enrollment state.
- Authenticated outbound WebSocket, SSE or polling session.
- Sites-specific transport integration.
- Persistent nonce database.
- Native desktop-control, process-management or terminal-execution adapter.
- The bridge dispatcher is not yet wired into the stdio MCP process.

The pairing client starts enrollment and returns a short-lived code for the user to complete in the cloud account. It does not establish a remote-control session. Do not expose this module through an unauthenticated local HTTP listener. The eventual transport must be initiated by the local agent and must deliver only signed, short-lived requests to this dispatcher.

## Request contract

The envelope matches `packages/protocol/src/envelope.ts` in the separate BrewPilot repository. Keep canonical serialization, digest rules, timestamp units, field names and signature encoding compatible.

## Local policy

A valid cloud signature does not authorize an operation. The local `PermissionManager` is independently evaluated for every request. Cloud-side approval cannot override a local deny. The dispatcher refuses unsupported capability/operation pairs and fails closed when audit recording is unavailable before execution.
