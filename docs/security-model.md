# Security model

## Default posture

- Unmatched operations are denied.
- Browser and system-information operations begin behind explicit permission policies.
- Persistent `always` policies require an explicit user configuration action.
- Session grants are scoped to an exact capability, operation and resource.
- Destructive and privileged operations always require fresh confirmation, even when a persistent policy exists.
- Operating-system elevation is never inferred from an application-level permission.

## One-time approvals

An `approval_required` response contains:
- the exact capability, operation and resource tuple;
- a cryptographically random request ID;
- a SHA-256 digest of the exact JSON action arguments;
- a 60-second validity window.

The approval tool requires the request ID, digest and exact permission tuple. The local process verifies them against its pending request before issuing a one-time grant. The grant is consumed only by a retry with the same canonical action arguments and expires after 60 seconds. A mismatch, expiry, policy reset or session revocation prevents use.

The MCP host must call the approval tool only after the user explicitly confirms the specific operation. The token is a technical binding mechanism, not proof that a human saw or accepted the prompt.

## Secrets and audit

- Do not log passwords, cookies, authorization headers, API keys, private keys or other credentials.
- Approval digests are transient and are not stored in the audit log.
- Current audit events are in-memory only and are lost when the process exits.
- The local policy file is stored with restrictive permissions where supported.

## Browser trust boundary

Webpage content is untrusted input. It cannot grant permissions or override the user's rules. BrewPilot uses a dedicated browser profile and does not attach to the user's everyday browser profile. Authentication should be completed directly in the launched browser.

## Not a security guarantee

This model does not replace operating-system account isolation, endpoint protection, browser sandboxing or human review. A compromised local process or MCP host can undermine application-level controls. Do not use BrewPilot to bypass CAPTCHAs, paywalls, access controls or security checks.
