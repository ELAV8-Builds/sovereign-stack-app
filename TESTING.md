# Testing Guide - Sovereign Stack Control Panel

This guide covers testing procedures for the Tauri control panel app before distribution.

## Prerequisites for Testing

### Development Environment
- macOS 13.0+ (Ventura or later)
- Xcode Command Line Tools: `xcode-select --install`
- Rust toolchain: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- Node.js 22+: `brew install node@22`
- Tauri CLI: `cargo install tauri-cli`

### Test Machines
Ideally, test on:
1. **Clean macOS install** (VM or fresh Mac)
2. **Your development machine** (with existing tools)
3. **Different architectures**:
   - Apple Silicon (M1/M2/M3)
   - Intel x86_64

## Phase 1: Development Build Testing

### 1.1 Build the Frontend
```bash
cd sovereign-stack-app
npm install
npm run build
```

**Expected:**
- ✅ No TypeScript errors
- ✅ Vite builds successfully
- ✅ Output in `dist/` directory
- ✅ Total bundle size < 250KB gzipped

### 1.2 Build the Rust Backend
```bash
cd src-tauri
cargo build
```

**Expected:**
- ✅ All Rust modules compile
- ✅ No clippy warnings (run `cargo clippy`)
- ✅ Binary created in `target/debug/`

### 1.3 Run in Development Mode
```bash
npm run tauri dev
```

**Test Cases:**
- [ ] App window opens (1200x800)
- [ ] Pre-flight checks run automatically
- [ ] System info displays correctly (macOS version, architecture, disk space)
- [ ] No console errors in DevTools
- [ ] Navigation works (Setup → Dashboard → Settings)

### 1.4 Test Tauri IPC Commands
Open DevTools Console and run:

```javascript
// Test system commands
await invoke('get_system_info')
await invoke('run_preflight_checks')

// Test service status
await invoke('get_services_status')

// Test Homebrew check
await invoke('check_homebrew_installed')
```

**Expected:**
- ✅ All commands return valid data
- ✅ No "command not found" errors
- ✅ Data matches TypeScript interfaces

## Phase 2: Setup Wizard Testing

### 2.1 Pre-Flight Checks
**Test Scenarios:**
1. **Insufficient disk space:**
   - Simulate by checking a partition with < 20GB free
   - Expected: Error message, cannot proceed

2. **Unsupported macOS version:**
   - Test on macOS 12 or earlier (if available)
   - Expected: Warning displayed

3. **Valid system:**
   - macOS 13+, 20GB+ free, arm64 or x86_64
   - Expected: Green "passed" indicator

### 2.2 Privileged Installer (.pkg)
**Prerequisites:**
```bash
# Build the .pkg on macOS
./build-pkg.sh
```

**Test Steps:**
1. Click "Continue" after pre-flight checks pass
2. App should invoke the .pkg installer
3. Admin password prompt should appear
4. Wait for installation to complete

**Verify:**
```bash
# Check sovereign user was created
id sovereign

# Check directory structure
ls -la /Users/sovereign/sovereign-stack/

# Check LaunchDaemon
sudo launchctl list | grep sovereign
```

**Expected:**
- ✅ `sovereign` user exists
- ✅ Directories created with correct ownership
- ✅ Docker socket helper LaunchDaemon loaded

### 2.3 Dependency Installation
**Test manually (or let wizard do it):**

```bash
# Homebrew
which brew

# Node.js
node --version  # Should be v22.x

# Python
python3 --version  # Should be 3.11+

# Docker
docker --version

# Ollama
ollama --version
```

**Expected:**
- ✅ All dependencies install without errors
- ✅ Progress indicators update correctly
- ✅ Error handling for failed installs

### 2.4 Repository Cloning
**Note:** Update URLs in SetupWizard.tsx before testing:
```typescript
url: "https://github.com/YOUR-ORG/nanoclaw.git",
url: "https://github.com/YOUR-ORG/memu.git",
```

**Verify:**
```bash
ls /Users/sovereign/sovereign-stack/nanoclaw
ls /Users/sovereign/sovereign-stack/memu
```

**Expected:**
- ✅ Repos cloned successfully
- ✅ `npm install` runs in nanoclaw
- ✅ `npm run build` completes

### 2.5 Model Pulling
**Test:**
```bash
ollama list
```

**Expected:**
- ✅ `nomic-embed-text` model appears (274MB)
- ✅ Progress bar updates during download
- ✅ No timeout errors

## Phase 3: Dashboard Testing

### 3.1 Service Status Grid
**Setup:** Start some services manually:
```bash
# Start Ollama
brew services start ollama

# Start Docker containers
docker-compose up -d postgres temporal anythingllm
```

**Test:**
- [ ] Dashboard shows 7 service cards
- [ ] Ollama shows "Running" (green)
- [ ] Services in Docker show "Running" if ports respond
- [ ] Services not running show "Stopped" (red)
- [ ] Status auto-refreshes every 5 seconds

### 3.2 Service Controls
**Test Start:**
1. Click "Start" on a stopped service
2. Wait for action to complete
3. Verify status changes to "Running"

**Test Stop:**
1. Click "Stop" on a running service
2. Wait for action to complete
3. Verify status changes to "Stopped"

**Test Restart:**
1. Click "Restart" on a running service
2. Verify brief "Stopped" then back to "Running"

**Expected:**
- ✅ Buttons disable during action
- ✅ No double-clicks register
- ✅ Error toast if action fails
- ✅ Success reflected in status grid

### 3.3 Log Viewer
**Test:**
1. Click on a service card
2. Log viewer panel opens on the right
3. Shows last 100 lines of logs
4. Logs auto-refresh every 5 seconds

**Verify:**
```bash
# Check log files exist
ls /Users/sovereign/sovereign-stack/logs/
```

**Expected:**
- ✅ Logs displayed in monospace font
- ✅ Scrollable container
- ✅ "Loading logs..." placeholder when none available
- ✅ Error message if log file doesn't exist

### 3.4 Settings Page
**Test:**
1. Click "⚙️ Settings" button
2. Settings page loads
3. System info section displays correctly
4. API key input works
5. Can navigate back to Dashboard

**Test API Key Storage:**
```javascript
// In DevTools Console
localStorage.getItem('anthropic_api_key')
```

**Note:** In production, this should use macOS Keychain via Tauri's keychain plugin.

## Phase 4: Production Build Testing

### 4.1 Build the DMG
```bash
# Ensure .pkg is built first
./build-pkg.sh

# Build DMG
npm run tauri build -- --bundles dmg
```

**Expected:**
- ✅ Build completes without errors
- ✅ DMG created in `src-tauri/target/release/bundle/dmg/`
- ✅ File size is reasonable (< 10MB without sidecars)

### 4.2 Test DMG Installation
**On a clean macOS VM or test Mac:**

1. **Mount DMG:**
   ```bash
   open "Sovereign Stack.dmg"
   ```

2. **Drag to /Applications**

3. **First Launch:**
   - Double-click app
   - Expect Gatekeeper warning (if not signed)
   - Right-click → Open to bypass

4. **Run through setup wizard**

**Expected:**
- ✅ App installs to /Applications
- ✅ Icon displays correctly
- ✅ Embedded .pkg is accessible
- ✅ All UI screens work

### 4.3 Code Signing (Optional for Internal Testing)
**Required for distribution outside dev team:**

```bash
# Sign the .pkg
productsign --sign "Developer ID Installer: Your Name" \
  src-tauri/resources/sovereign-setup.pkg \
  src-tauri/resources/sovereign-setup-signed.pkg

# Update tauri.conf.json to use signed version

# Rebuild DMG (Tauri will auto-sign the app)
npm run tauri build -- --bundles dmg

# Notarize
xcrun notarytool submit "Sovereign Stack.dmg" \
  --apple-id "your@email.com" \
  --team-id "ABCD1234" \
  --password "@keychain:AC_PASSWORD" \
  --wait

# Staple ticket
xcrun stapler staple "Sovereign Stack.dmg"
```

**Verify:**
```bash
spctl -a -vv /Applications/Sovereign\ Stack.app
```

**Expected:**
```
/Applications/Sovereign Stack.app: accepted
source=Notarized Developer ID
```

## Phase 5: Integration Testing

### 5.1 Full Stack Deployment
**Test end-to-end:**
1. Fresh macOS install (VM recommended)
2. Install DMG
3. Run setup wizard completely
4. Verify all 7 services start successfully
5. Test dashboard controls
6. Check logs for errors

**Services to verify:**
```bash
# NanoClaw
launchctl list | grep nanoclaw

# LiteLLM
curl http://localhost:4000/health

# Ollama
curl http://localhost:11434/api/tags

# memU
curl http://localhost:8090/health

# PostgreSQL
docker ps | grep postgres

# Temporal
docker ps | grep temporal

# AnythingLLM
curl http://localhost:3001
```

### 5.2 Two-User Permission Model
**Verify:**
```bash
# Check Docker socket permissions
ls -l /var/run/docker.sock

# Check sovereign can access Docker
su - sovereign -c "docker ps"

# Check LaunchAgent ownership
ls -la /Users/sovereign/Library/LaunchAgents/
```

**Expected:**
- ✅ `docker.sock` has 666 permissions (managed by LaunchDaemon)
- ✅ Sovereign user can run `docker ps`
- ✅ Services run as sovereign user
- ✅ Admin user can control sovereign's services

## Phase 6: Error Handling Testing

### 6.1 Network Errors
**Test:**
- Disconnect WiFi during repo clone
- Expected: Error message, retry option

### 6.2 Permission Errors
**Test:**
- Run app as non-admin user
- Try to invoke .pkg installer
- Expected: Admin prompt appears

### 6.3 Port Conflicts
**Test:**
```bash
# Block port 4000
nc -l 4000
```
- Try to start LiteLLM
- Expected: Error message about port conflict

### 6.4 Missing Dependencies
**Test:**
- Uninstall Homebrew
- Run dependency check
- Expected: Offers to install Homebrew

## Phase 7: Performance Testing

### 7.1 Startup Time
**Measure:**
```bash
time open -a "Sovereign Stack"
```

**Expected:**
- ✅ App opens in < 2 seconds
- ✅ Pre-flight checks complete in < 5 seconds

### 7.2 Memory Usage
**Monitor:**
```bash
# While app is running
top -pid $(pgrep "Sovereign Stack")
```

**Expected:**
- ✅ Memory usage < 200MB at idle
- ✅ No memory leaks over 1 hour

### 7.3 Auto-Refresh Performance
**Test:**
- Leave dashboard open for 10 minutes
- Monitor network requests in DevTools

**Expected:**
- ✅ Service status checks every 5 seconds
- ✅ No excessive API calls
- ✅ UI remains responsive

## Checklist: Ready for Distribution

Before shipping to users, ensure:

- [ ] All Phase 1-7 tests pass
- [ ] No console errors or warnings
- [ ] README.md is up to date
- [ ] .pkg is signed with Developer ID Installer cert
- [ ] App is signed and notarized
- [ ] DMG is stapled
- [ ] GitHub Release created with:
  - [ ] DMG attached
  - [ ] Release notes
  - [ ] Installation instructions
- [ ] Tested on clean macOS VM
- [ ] Tested on both Intel and Apple Silicon

## Known Issues / Future Work

- API keys currently stored in localStorage (should use Keychain)
- No auto-updater yet (planned for Phase 4)
- DMG background image not customized
- No telemetry or crash reporting

## Troubleshooting

### App Won't Open
- Check Console.app for errors
- Verify Gatekeeper didn't block it
- Try: `xattr -cr /Applications/Sovereign\ Stack.app`

### Services Won't Start
- Check launchctl: `launchctl list | grep sovereign`
- Check logs: `tail -f /Users/sovereign/sovereign-stack/logs/*.log`
- Verify ports aren't in use: `lsof -i :4000`

### .pkg Fails to Install
- Check `/var/log/install.log`
- Check `/var/log/sovereign-stack-install.log`
- Ensure running as admin

---

For questions or issues, see the GitHub repository:
https://github.com/ELAV8-Builds/sovereign-stack-app
