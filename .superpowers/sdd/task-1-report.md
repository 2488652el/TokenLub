# Task 1 report

## Scope

Implemented main-process provider endpoint origin binding and credential re-entry protection.

## Changes

- Added `src/main/providers/endpoint-policy.ts`.
  - Hosted providers require HTTPS.
  - `newapi-generic` may use HTTP only on loopback hosts.
  - Origins are normalized before comparison.
  - Manual-provider origin clearing is not treated as a credential-bound change.
- Updated `src/main/store/keys-repo.ts`.
  - Validates create/update endpoint overrides before persistence.
  - Rejects non-manual origin changes when `apiKey` is omitted.
- Updated `src/main/ipc/register-handlers.ts`.
  - Loads the existing key and validates the update endpoint at the IPC boundary.
- Added endpoint policy tests and a store regression test proving an encrypted key cannot be rebound without replacement credentials.

## Verification

- RED observed before implementation: missing policy module and origin-change update was accepted.
- `npx vitest run tests/unit/endpoint-policy.test.ts tests/unit/store/keys-extra.test.ts tests/unit/ipc-schemas.test.ts --reporter=verbose` — 24 tests passed.
- `npm run typecheck` — passed.
- `npm test -- --run` — 47 files / 306 tests passed.

## Files changed

- `src/main/providers/endpoint-policy.ts`
- `src/main/store/keys-repo.ts`
- `src/main/ipc/register-handlers.ts`
- `tests/unit/endpoint-policy.test.ts`
- `tests/unit/store/keys-extra.test.ts`

## Follow-up review fixes

- HTTPS endpoints are now restricted to origins documented in the provider catalog; attacker-controlled HTTPS origins are rejected.
- `newapi-generic` allows HTTP/HTTPS only for localhost, loopback, or RFC1918 private IPv4 addresses, and rejects other schemes/public hosts.
- Endpoint rebinding requires a replacement main key and all previously stored extra credential fields. On rebinding, the submitted extra map replaces the old map instead of merging it.

Follow-up verification: focused 25 tests passed, `npm run typecheck` passed, and full suite passed with 47 files / 307 tests.

## Re-review fixes

- Credential re-entry checks now trim `apiKey`, so whitespace-only replacements are rejected and cannot preserve the old encrypted key during an origin change.
- `newapi-generic` accepts any valid HTTP or HTTPS self-hosted endpoint, including public HTTPS proxy domains; non-HTTP(S) schemes remain rejected.

Re-review verification: focused 26 tests passed, `npm run typecheck` passed, and full suite passed with 47 files / 308 tests.
