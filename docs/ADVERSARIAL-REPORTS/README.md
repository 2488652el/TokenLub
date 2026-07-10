# Adversarial Review Reports

One report per phase. Each report must contain:

1. **Goal of the phase**
2. **Exit criteria** (copy from the plan file)
3. **Files added / modified**
4. **Commands run** (lint, typecheck, build, test) with their pass/fail status
5. **Findings** — anything that didn't meet the bar:
   - Empty / placeholder UI elements (CRITICAL — must be removed or wired)
   - IPC payload schema mismatches
   - API key leakage in renderer or logs
   - Decimal precision loss in cost math
   - Build / type errors
   - Security issues
6. **Fixes applied** for each finding

`phase-a.md` is the report for Phase A scaffold.