# Bridge activation checklist

This document defines the release gates for connecting BrewLocal to the separate BrewPilot cloud service.

## Current boundary

BrewLocal remains a local stdio MCP server. The repository contains signed-envelope verification, nonce replay protection, a platform registry, and permission-gated local file reads. These components do not by themselves create a working remote connection.

Do not add a public inbound listener to the local agent. The local agent must initiate its connection outbound and independently authorize every operation.

## Required implementation sequence

1. **Protocol parity** — keep the envelope schema, canonical JSON rules, digest algorithm, field limits, expiry, and signature encoding identical to `SneppX/BrewPilot`.
2. **Local policy adapter** — pass verified requests to the existing local permission manager. A cloud-signed request must never be treated as a local permission grant.
3. **Device identity** — create a per-installation Ed25519 keypair using OS-appropriate protected storage. Never export the private key or write it to audit logs.
4. **Pairing** — use a short-lived, single-use pairing challenge. Display the challenge locally and require the user to complete the matching cloud pairing flow.
5. **Outbound transport** — implement authenticated TLS, bounded frames and queues, heartbeat, cancellation, reconnect backoff, and server identity validation.
6. **Revocation** — stop accepting work when a device is revoked, the pairing is removed, or the authenticated session expires.
7. **Audit** — record decisions and outcomes with opaque IDs and redacted resource identifiers. Do not store raw file contents, page contents, secrets, or command output.
8. **Platform adapters** — implement Windows, macOS, and Linux behind the same capability contract, with platform-specific permission prompts where required.

## Mandatory negative tests

- Invalid signature, unknown key, wrong device ID, expired request, future-issued request, excessive lifetime, digest mismatch, malformed envelope, replayed nonce, and oversized payload.
- Request for a device owned by another account.
- Cloud request that conflicts with a local deny policy.
- Persistent allow policy attempting to bypass destructive or privileged confirmation.
- Revoked device attempting to reconnect or complete queued work.
- Transport disconnect during an operation and duplicate delivery after reconnect.
- Symlink/path traversal attempts and files that change between validation and read.

## Release rule

Do not expose a cloud-connected tool in the installed local plugin until the complete outbound connection, device pairing, revocation, and local policy path has passed automated and manual tests on all three operating systems. Keep the current local-only MCP workflow working throughout development.
