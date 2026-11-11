# Architecture

BrewPilot Local is a local-first MCP server. The MCP process runs on the user's machine and communicates with the host over standard input and standard output.

## Runtime layers

1. **MCP transport** — accepts JSON-RPC messages over stdio and exposes the tool catalog.
2. **Tool orchestration** — validates tool inputs, selects the operation and invokes the appropriate capability.
3. **Permission manager** — applies deny-by-default policies, exact session grants, expiring one-time approvals and mandatory fresh confirmation for destructive or privileged operations.
4. **Policy store** — persists user-selected rules in the local BrewPilot configuration directory using restrictive file modes and atomic replacement.
5. **Audit log** — retains redacted decision events in process memory for the current session.
6. **Capability adapters** — browser automation and basic system information are implemented; native desktop adapters are a separate, unfinished layer.

## Data flow

```text
ChatGPT / MCP host
        |
        | JSON-RPC over stdio
        v
Local MCP server
        |
        v
Tool input validation
        |
        v
Permission manager -----> Local policy store
        |
        +---- denied / approval required
        |
        v
Capability adapter
        |
        v
Structured result + redacted audit event
```

## Local-only boundary

The local plugin does not include a cloud relay, remote-control endpoint, account system or telemetry service. Its browser profile, permission configuration and runtime execute on the user's machine. The separate BrewPilot cloud MCP project must not be confused with this local runtime.

## Extension rules

New capabilities must be registered explicitly. Unknown tools and unmatched permission rules fail closed. Adapters must not execute before authorization, and adapters must not interpret webpage text or remote content as user approval.
