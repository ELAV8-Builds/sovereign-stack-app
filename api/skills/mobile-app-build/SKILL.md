---
name: mobile-app-build
category: mobile-app-build
version: "1.0"
target_type: mobile_app
required_capabilities:
  - swift
  - swiftui
  - mobile_app_build
default_config:
  framework: swiftui
  language: swift
  platform: apple
  min_iterations: 2
  max_iterations: 5
cleanup_profile: Mobile App Cleanup
---

# Mobile App Build Skill

Build a native mobile application using SwiftUI.

## Level 1 — Quick Brief

You are building a native iOS/macOS app with SwiftUI. Follow these rules:
1. Use SwiftUI with MVVM architecture
2. Keep every file under 300 lines
3. Use async/await for all network calls
4. Show loading states and error alerts for every async operation
5. No hardcoded strings — use constants or localization
6. Build must compile with zero warnings

## Level 2 — Detailed Instructions

### Project Structure
```
App/
├── Models/          # Data models and codable structs
├── Views/           # SwiftUI views organized by feature
│   ├── Feature1/
│   ├── Feature2/
│   └── Shared/      # Reusable view components
├── ViewModels/      # ObservableObject view models
├── Services/        # Network, storage, and utility services
├── Extensions/      # Swift extensions
└── Resources/       # Assets, localization files
```

### Implementation Rules
- **Views:** Max 300 lines. Split complex views into sub-views
- **View Models:** One per major feature screen, use `@Published` properties
- **Services:** Protocol-based for testability
- **Navigation:** NavigationStack with `.navigationDestination`
- **Data Persistence:** SwiftData or UserDefaults (no Core Data unless required)
- **Networking:** URLSession with async/await, never use completion handlers

### Error Handling
- Every network call wrapped in do/catch
- Show `.alert` modifier for user-facing errors
- Log detailed errors for debugging
- Never use empty catch blocks

### State Management
- `@State` for view-local state
- `@StateObject` / `@ObservedObject` for view models
- `@EnvironmentObject` for app-wide state
- `@AppStorage` for user preferences

## Level 3 — Exhaustive Reference

### Build Pipeline
1. `xcodebuild build` — Zero errors
2. `swiftlint` — If configured, must pass
3. Simulator test on target devices
4. Check for memory leaks with Instruments

### Quality Gates
- No files over 500 lines
- No force unwraps (`!`) except IBOutlets (not used in SwiftUI)
- No unused imports
- All views respond to Dynamic Type
- Dark mode support
- Proper error handling (no empty catches)
