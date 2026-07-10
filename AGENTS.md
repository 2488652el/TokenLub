# Project Agent Instructions — TokenLub

Durable, project-level guidance for any agent working in this repo.
These rules apply on top of (never in place of) user instructions in the
current session.

## Packaging output directories — Zcode identifier

When the agent creates a **new packaging output directory** (e.g. to work
around a file lock on the default `artifacts/dist`, or to produce a
side-by-side build), the directory name MUST carry a `Zcode` identifier so
its origin is unambiguous.

Convention:

- Prefer placing builds under the git-ignored `artifacts/` tree.
- Name new dirs with a `Zcode-` prefix, e.g.
  `artifacts/Zcode-dist-<purpose>` or `artifacts/Zcode-build-<YYYYMMDD>`.
- Do NOT reuse or overwrite the default `artifacts/dist/` for a side build;
  leave the canonical output path for `npm run dist:win`.
- Keep `Zcode*` patterns out of git: any new top-level `Zcode-*` dir should
  be added to `.gitignore` if it is created outside `artifacts/`.

Rationale: a previous packaging run collided with a stale handle on
`release/win-unpacked/resources/app.asar` and had to write to a throwaway
`release3/`. Going forward, side builds are clearly attributed to Zcode
and stay separate from canonical releases.
