# Platform support

BrewLocal targets Windows, macOS and Linux from the same local MCP runtime.

## Current implementation

| Capability | Windows | macOS | Linux |
| --- | --- | --- | --- |
| Node.js local MCP runtime | Supported | Supported | Supported |
| Permission policy storage | Supported | Supported | Supported |
| Browser automation | Supported when a compatible Chromium browser is installed | Supported when a compatible Chromium browser is installed | Supported when a compatible Chromium browser is installed |
| Basic system information | Supported | Supported | Supported |
| Native desktop/window control | Not implemented | Not implemented | Not implemented |
| File operations | Not implemented | Not implemented | Not implemented |
| Process management | Not implemented | Not implemented | Not implemented |
| Terminal execution | Not implemented | Not implemented | Not implemented |

The platform registry is an adapter-selection boundary, not a claim that native desktop automation is already available. The runtime reports native desktop control as `not_implemented` until an adapter has passed platform-specific tests.

## Adapter contract

Platform-specific code belongs behind `server/platform/`. Shared policy, audit and tool orchestration remain in `server/core/`. Adapters must not bypass the permission manager.

Every future adapter must:
- declare its supported operations and risk levels;
- validate and normalize resource identifiers before authorization;
- reject unsupported platforms and unknown operations;
- avoid shell-string construction for process launches;
- enforce bounded execution time and output size;
- return structured errors without leaking secrets or environment variables;
- have platform-specific integration tests.

## Supported runtime

Node.js 22 or later is required. Browser automation uses a dedicated BrewPilot profile and requires a supported Chromium-based browser installed locally.
