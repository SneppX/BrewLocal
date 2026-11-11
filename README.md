# BrewLocal

BrewLocal is the public source repository for BrewPilot's local MCP plugin. The installed private ChatGPT plugin remains a separate release artifact; changes in this repository are not automatically installed into that plugin.

## Product boundaries

- **BrewLocal** — local MCP server, browser automation, local permissions and local capability adapters.
- **BrewPilot cloud** — separate cloud MCP project and future device relay.
- **BrewSite** — separate product website.

The local runtime does not open an inbound network listener and does not include a cloud relay.

## Current local plugin baseline

The imported plugin release is **0.2.1**. It includes:
- Isolated Chromium-based browser automation.
- Local permission policies: `deny`, `ask`, `session`, `always`.
- Deny-by-default behavior for unmatched capabilities.
- Exact one-time and session grants.
- Basic system information.
- In-memory redacted audit events.

## Repository development additions

The repository now also contains unreleased development work:
- One-time approvals bound to a random request ID, exact argument digest and 60-second expiry.
- Canonical JSON hashing shared with the cloud bridge protocol.
- Signed Ed25519 request verification, expiry checks and replay protection.
- A transport-neutral local bridge dispatcher that independently enforces local policy.
- Windows, macOS and Linux platform registry.
- Permission-gated, non-recursive directory listing and bounded UTF-8 text-file reads.
- Absolute local paths are hashed in audit events.
- Cross-platform CI and security workflows.

These repository additions are not yet part of the installed private plugin release. They must pass CI and be reviewed before a new plugin package is published.

## Development

Requirements: Node.js 22 or later.

```bash
npm run check
npm test
```

The project currently uses Node.js built-in modules and the built-in test runner. No dependency installation is needed.

## Permission model

Unmatched capabilities are denied. Before using the new file tools, configure narrow rules for the exact canonical directory or file path. Do not create broad `always` rules unless you deliberately intend to grant persistent access.

Destructive and privileged operations remain outside the current implementation and must require fresh confirmation in future adapters.

## Platform status

See [platform support](docs/platform-support.md), [architecture](docs/architecture.md), and [security model](docs/security-model.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).
