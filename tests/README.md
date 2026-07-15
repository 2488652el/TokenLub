# Tests

- `unit/` - Vitest unit tests for parsers, stores, providers, and IPC contracts.
- `integration/` - in-memory and optional external-service integration tests.
- `e2e/` - Playwright tests against Electron and packaged applications.
- `fixtures/` - synthetic API responses and JSONL files.

## macOS packaged smoke test

Build and test each architecture on macOS. The profile path must not already
exist; the test creates and removes it, and overrides `HOME` so it never scans
real Claude or Codex directories.

```bash
TOKENLUB_PACKAGED_APP="/path/to/x64/TokenLub.app" \
TOKENLUB_TEST_USER_DATA="/tmp/tokenlub-e2e-x64" \
npm run test:e2e -- tests/e2e/macos-packaged-startup.spec.ts

TOKENLUB_PACKAGED_APP="/path/to/arm64/TokenLub.app" \
TOKENLUB_TEST_USER_DATA="/tmp/tokenlub-e2e-arm64" \
npm run test:e2e -- tests/e2e/macos-packaged-startup.spec.ts
```

The smoke test verifies preload, platform log paths, isolated SQLite setup,
settings, synthetic API-key encryption/storage, empty log discovery, and the
request-log page. Never use a real API key or an existing profile path.
