---
name: web-app-cleanup
category: web-app-cleanup
version: "1.0"
target_type: web_app
required_capabilities:
  - typescript
  - web_app_cleanup
default_config:
  linters:
    - tsc
    - eslint
  target: web_app
  min_iterations: 1
  max_iterations: 3
cleanup_profile: Web App Cleanup
---

# Web App Cleanup Skill

Refactor and clean up an existing web application codebase.

## Level 1 — Quick Brief

You are cleaning up a web app codebase. Your goal:
1. Split any file over 300 lines into sub-components
2. Remove dead code and unused exports
3. Fix all TypeScript errors
4. Centralize duplicate type definitions
5. Run `tsc --noEmit && npm run build` to verify zero errors after every change

## Level 2 — Detailed Instructions

### Audit Phase
1. Run `tsc --noEmit` and note all errors
2. Scan for files over 300 lines: `find src -name "*.ts" -o -name "*.tsx" | xargs wc -l | sort -rn`
3. Check for `as any` casts: `grep -rn "as any" src/`
4. Check for empty catch blocks: `grep -rn "catch.*{}" src/`
5. Check for `console.log`: `grep -rn "console.log" src/`
6. Check for hardcoded URLs: `grep -rn "http://" src/ --include="*.ts" --include="*.tsx"`
7. Check for duplicate type definitions across files

### Splitting Oversized Files
For each file over 300 lines:
1. Identify logical groupings (by feature, by UI section, by responsibility)
2. Create a subdirectory named after the parent component
3. Extract each group into its own file
4. The parent file becomes a thin orchestrator that imports sub-components
5. Move shared types to `src/types/` or a local `types.ts`

### Type Centralization
1. Find all interfaces/types that appear in multiple files
2. Create `src/types.ts` or `src/types/` directory
3. Move shared types there
4. Update all imports

### Dead Code Removal
1. Check for unused exports (functions, components, types)
2. Remove commented-out code blocks (> 5 lines)
3. Remove unused imports

### Verification
After every change:
1. `tsc --noEmit` — must pass
2. `npm run build` — must pass
3. Verify the app still renders correctly

## Level 3 — Exhaustive Reference

### Quality Score Rubric
| Score | Criteria |
|-------|----------|
| 10/10 | 0 files >300 lines, 0 type errors, full test coverage, no dead code |
| 8-9/10 | 0 files >500 lines, 0 type errors, some test coverage, minimal dead code |
| 6-7/10 | 0 files >500 lines, few type errors, no test coverage |
| 4-5/10 | Some files >500 lines, type errors present, dead code |
| <4/10 | Multiple oversized files, many errors, significant dead code |

### Cleanup Report Format
After completing cleanup, generate a report:
```markdown
# Code Cleanup Report
- Files modified: N
- Files added: N (sub-components)
- Lines before: N
- Lines after: N
- Files over 500 lines: Before X → After Y
- Files over 300 lines: Before X → After Y
- Build status: PASSING/FAILING
- Quality score: Before X/10 → After Y/10
```
