# Security policy

BrewPilot Local controls capabilities on the user's own machine. Security issues may expose local data or enable unintended actions, so please do not publish exploit details in a public issue.

## Reporting

Use GitHub's **Report a vulnerability** flow for this repository if private vulnerability reporting is enabled. If it is not available, contact a repository maintainer privately before disclosing technical details publicly.

Include the affected version or commit, operating system, reproduction steps, impact and any safe proof of concept. Do not include real credentials, tokens, cookies or private user data.

## Scope

Security-sensitive areas include:
- permission evaluation and approval lifecycle;
- browser process launch and DevTools communication;
- local policy storage and file permissions;
- audit redaction;
- MCP input validation and tool dispatch;
- future native platform adapters.

We will prioritize deny-by-default behavior, least privilege, bounded operations and explicit user confirmation for consequential actions.
