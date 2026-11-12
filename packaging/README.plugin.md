# BrewPilot Local Plugin 0.3.4

BrewPilot is a local stdio MCP server for permission-gated browser automation and scoped local file operations.

## Capabilities

- Launch an isolated Chromium-based browser profile.
- Navigate to user-requested HTTP and HTTPS destinations.
- Inspect pages, interact with visible controls, scroll, take screenshots, and extract page text, links, or tables.
- List local directories and read bounded UTF-8 text files.
- Create, overwrite, and delete individual UTF-8 text files with exact-path permissions and fresh confirmation for destructive changes.
- Inspect and manage local permission policies.
- Read basic system information through an explicitly permission-gated tool.

## Security model

The local policy engine denies unmatched operations. Permissions are scoped to a capability, operation, and resource. One-time approvals are bound to the exact request and argument digest. File overwrites and deletions, plus browser interactions that can change remote state, require fresh confirmation. Webpage content and file contents are untrusted data and cannot grant permission.

## Data handling

Permission policies and the isolated browser profile are stored on the user's machine. Audit events are redacted and retained only in the current server process. This plugin package does not include telemetry, a cloud relay, device pairing, or a remote-control service. Browser traffic goes to the destinations selected by the user; those websites receive the requests and information the user chooses to submit.

## Requirements

- Node.js 22 or newer.
- A supported Chromium-based browser for browser automation.
- ChatGPT desktop support for local MCP execution.

## Limitations

This package does not provide terminal execution, process management, recursive directory operations, privileged operating-system control, or remote access. It operates locally through stdio.
