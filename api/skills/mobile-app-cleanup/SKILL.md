---
name: mobile-app-cleanup
category: mobile-app-cleanup
version: "1.0"
target_type: mobile_app
required_capabilities:
  - swift
  - mobile_app_cleanup
default_config:
  linters:
    - swiftc
  target: mobile_app
  min_iterations: 1
  max_iterations: 3
cleanup_profile: Mobile App Cleanup
---

# Mobile App Cleanup Skill

Refactor and clean up an existing mobile application codebase.

## Level 1 — Quick Brief

You are cleaning up a mobile app codebase. Your goal:
1. Split any file over 300 lines into smaller focused files
2. Remove orphan screens (views not reachable from navigation)
3. Audit permission declarations (only request what's used)
4. Fix all compiler warnings
5. Verify the app builds with zero errors after every change

## Level 2 — Detailed Instructions

### Audit Phase
1. Build the project and note all warnings/errors
2. Find oversized files: files over 300 lines
3. Check for force unwraps: `grep -rn "!" *.swift` (filter false positives)
4. Check for empty catch blocks
5. Check for orphan views (not referenced in navigation)
6. Audit Info.plist for unused permission strings

### Splitting Strategy
For Swift files:
- Extract sub-views into separate files in a feature folder
- Extract extensions into `ModelName+Feature.swift` files
- Move shared utilities to `Extensions/` or `Helpers/`
- Keep protocol conformances in extensions

For React Native (if applicable):
- Same strategy as web-app-cleanup
- Pay attention to native module bridges

### Permission Audit
1. List all declared permissions in Info.plist
2. Search codebase for actual usage of each permission API
3. Remove any permission declarations not backed by code usage
4. Ensure usage descriptions are clear and specific

### Verification
After every change:
1. `xcodebuild build` or `swift build` — must pass
2. Run on simulator to verify navigation
3. Check that all screens are reachable

## Level 3 — Exhaustive Reference

### Quality Score Rubric
| Score | Criteria |
|-------|----------|
| 10/10 | 0 files >300 lines, 0 warnings, all permissions audited, full tests |
| 8-9/10 | 0 files >500 lines, 0 errors, permissions clean, no orphans |
| 6-7/10 | 0 files >500 lines, few warnings, some unused permissions |
| <6/10 | Oversized files, unused screens, permission bloat |
