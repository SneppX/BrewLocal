# Contributing

## Requirements

- Node.js 22 or later
- npm
- A supported Chromium-based browser for browser integration work

## Development

```bash
npm run check
npm test
```

The test suite uses Node.js's built-in test runner. No dependency installation is required for the current runtime and test suite.

## Pull requests

- Keep changes focused and describe the security impact.
- Add or update tests for behavior changes.
- Never commit credentials, browser profiles, local policy files or personal data.
- Keep the permission check before every protected side effect.
- Do not add shell execution or broad filesystem access without a reviewed threat model and granular permission design.
- Update the platform support matrix when capability support changes.
- Do not describe planned native desktop features as implemented.

## Commit messages

Use concise conventional commit prefixes such as `feat:`, `fix:`, `test:`, `docs:`, `ci:` and `security:`.
