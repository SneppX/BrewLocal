# BrewPilot Local

BrewPilot Local is a cross-platform stdio MCP server for local browser automation and permission-gated computer operations.

## Implemented

- Browser automation for supported Chromium-based browsers.
- Isolated persistent browser profiles.
- Deny-by-default local permission policies.
- Exact one-time approvals bound to the operation, resource, and SHA-256 argument digest.
- Exact-resource session grants and explicit persistent policies.
- Fresh one-time confirmation for external and destructive operations, even when a persistent allow rule exists.
- Basic system information without usernames, hostnames, environment variables, file contents, or process lists.
- Shallow local directory listing and bounded UTF-8 file reads.
- Bounded UTF-8 file creation and overwrite with atomic replacement.
- Regular-file deletion with fresh confirmation.
- Symbolic-link rejection for file writes and deletion.
- Redacted in-memory audit events, including hashed absolute local paths.
- Signed Ed25519 request verification, canonical JSON, expiry checks, and in-memory replay protection.
- Windows, macOS, and Linux platform registry.

## Local file permissions

File operations are scoped to exact canonical paths:

- `files/list` — shallow directory metadata only.
- `files/read` — bounded UTF-8 text reads.
- `files/write` — create a new text file. Overwriting an existing file is classified as destructive.
- `files/delete` — always classified as destructive.

Unmatched operations are denied. External and destructive operations require a fresh exact one-time approval. Persistent policies cannot bypass those checks. Privileged operations remain blocked until a separate operating-system authorization adapter exists.

## Cloud bridge status

The repository includes signed request verification and a transport-neutral dispatcher. It does **not** yet include device pairing, durable nonce storage, the authenticated outbound relay, a cloud request queue, or an end-to-end deployed cloud service. Do not describe this repository as connected to ChatGPT or as a remote-control agent until those components are implemented and verified.

## Runtime

Requires Node.js 22 or newer. The MCP server runs locally over stdio using `node server/index.mjs`.

## Development checks

```bash
npm install
npm run check
```

CI tests Node.js 22 and 24 on Windows, macOS, and Linux.

## Security boundaries

- Cloud signatures prove request integrity; they do not grant local permission.
- The local permission manager is authoritative.
- Destructive and external actions require fresh confirmation.
- Raw file contents, secrets, and command output are not written to the audit log.
- No public inbound listener is provided.
