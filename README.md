# Sovereign Stack macOS Control Panel

A Tauri 2.0 macOS application for managing the Sovereign Stack - a complete AI agent infrastructure with NanoClaw, LiteLLM, Ollama, memU, PostgreSQL, Temporal, and AnythingLLM.

## Project Status: Phase 1 Complete ✅

Phase 1 (Foundation) has been completed with:
- ✅ Tauri 2.0 project initialized with React + TypeScript + Tailwind frontend
- ✅ Rust command layer with full IPC commands implementation
- ✅ Privileged .pkg installer for root operations
- ✅ DMG bundle configuration

## What Phase 1 Delivers

### 1. Tauri Project Structure
```
sovereign-stack-app/
├── src/                          # React frontend (TypeScript + Tailwind)
│   ├── App.tsx                   # Main app component (placeholder)
│   ├── App.css                   # Tailwind imports
│   └── main.tsx                  # React entry point
├── src-tauri/                    # Rust backend
│   ├── src/
│   │   ├── main.rs              # Tauri entry point
│   │   ├── lib.rs               # Command handler registration
│   │   └── commands/            # Tauri IPC commands
│   │       ├── system.rs        # Pre-flight checks, system info, shell execution
│   │       ├── services.rs      # Service status, start/stop/restart, logs
│   │       └── setup.rs         # Homebrew, dependencies, repos, Ollama
│   ├── resources/               # Embedded resources
│   │   └── sovereign-setup.pkg  # Privileged installer
│   └── tauri.conf.json          # Tauri configuration (DMG output)
├── pkg-scripts/                 # .pkg installer scripts
│   └── postinstall              # Root-level setup script
└── build-pkg.sh                 # .pkg build script (macOS only)
```

### 2. Rust Command Layer (IPC)

All commands are async and accessible from the React frontend via `invoke()`.

#### System Commands (`commands/system.rs`)
- `run_preflight_checks()` → Check macOS version (13+), architecture (arm64/x86_64), disk space (20GB+ required)
- `get_system_info()` → Get macOS version, architecture, hostname, current user
- `execute_shell_command(command, args)` → Execute arbitrary shell commands

#### Service Commands (`commands/services.rs`)
- `get_services_status()` → Check all 7 services (port checks + launchctl)
- `start_service(service_name)` → Start via launchctl
- `stop_service(service_name)` → Stop via launchctl
- `restart_service(service_name)` → Restart via launchctl
- `get_service_logs(service_name, lines)` → Tail service logs

**Services monitored:**
| Service | Port | Runtime | Purpose |
|---------|------|---------|---------|
| NanoClaw | N/A | Node.js | Agent brain, WhatsApp interface |
| LiteLLM | 4000 | Python | Model routing (5 tiers, Anthropic API) |
| Ollama | 11434 | Native | Local inference (nomic-embed-text only) |
| memU | 8090 | Python/uvicorn | Semantic memory API |
| PostgreSQL | 5432 | Docker | memU storage |
| Temporal | 7233 | Docker | memU workflow engine |
| AnythingLLM | 3001 | Docker | RAG / knowledge base |

#### Setup Commands (`commands/setup.rs`)
- `check_homebrew_installed()` → Check if Homebrew exists
- `install_homebrew()` → Install Homebrew
- `check_command_exists(command)` → Check if a command is available
- `brew_install(package)` → Install via Homebrew
- `brew_install_cask(cask)` → Install cask via Homebrew
- `clone_repository(url, destination)` → Clone git repo
- `npm_install(directory)` → Run npm install
- `npm_build(directory)` → Run npm build
- `ollama_pull_model(model)` → Pull Ollama model
- `check_sovereign_user_exists()` → Check if sovereign user exists
- `run_privileged_installer(pkg_path)` → Trigger .pkg with admin prompt

### 3. Privileged Installer (.pkg)

The `sovereign-setup.pkg` handles operations that require root access:

**Created by:** `build-pkg.sh` (must run on macOS with `pkgbuild`)
**Triggered by:** App calls `run_privileged_installer()` → user sees admin password prompt
**Script:** `pkg-scripts/postinstall` (runs as root)

**What it does:**
1. Creates `sovereign` user with `sysadminctl` (non-admin, random password)
2. Creates `/Users/sovereign/sovereign-stack/` directory tree (logs, data, configs)
3. Creates `/Users/Shared/sovereign-deploy/` bridge directory (sticky bit for shared access)
4. Configures macOS power settings (prevents sleep during operations)
5. Enables firewall + stealth mode (no ICMP ping responses)
6. Disables mDNS advertising (privacy)
7. Creates Docker socket helper LaunchDaemon (gives sovereign user access to Docker Desktop)

**Security notes:**
- The .pkg is invoked ONCE during initial setup
- Uses `osascript` with "with administrator privileges" for explicit user consent
- After setup, the app never needs root again (runs as admin user)
- For distribution, the .pkg must be signed with "Developer ID Installer" certificate

### 4. DMG Bundle Configuration

`tauri.conf.json` is configured to output a DMG:
```json
{
  "bundle": {
    "active": true,
    "targets": ["dmg"],
    "macOS": {
      "minimumSystemVersion": "13.0"
    },
    "resources": [
      "resources/sovereign-setup.pkg"
    ]
  }
}
```

## Two-User Architecture

The Sovereign Stack uses a two-user permission model:

| User | Role | Runs |
|------|------|------|
| *admin* (barney2-equivalent) | Interactive user | Cursor, Docker Desktop, Tauri app |
| *sovereign* | Service owner | All 7 stack services via LaunchAgents |

**Why two users?**
- Docker Desktop runs under admin (requires GUI/hypervisor)
- Services run as sovereign (isolation, security, no sudo)
- App runs as admin, manages sovereign's services

**Docker access:**
- Docker Desktop socket: `/var/run/docker.sock`
- Sovereign accesses via `DOCKER_HOST` env var
- Socket permissions: `chmod 666` via LaunchDaemon helper
- Uses `docker-compose` standalone binary (not Docker Compose plugin)

## Building the Project

### Prerequisites
- macOS 13+ (for SMAppService, notarization)
- Rust toolchain (`rustup`)
- Node.js 22+
- Tauri CLI (`cargo install tauri-cli`)

### Development Build
```bash
# Install dependencies
npm install

# Run in development mode
npm run tauri dev
```

### Production Build (DMG)
```bash
# 1. Build the privileged installer .pkg (macOS only)
./build-pkg.sh

# 2. Build the Tauri app + DMG
npm run tauri build -- --bundles dmg

# Output: src-tauri/target/release/bundle/dmg/Sovereign Stack.dmg
```

### Signing & Notarization (Distribution)
```bash
# 1. Sign the .pkg
productsign --sign "Developer ID Installer: Your Name" \
  src-tauri/resources/sovereign-setup.pkg \
  src-tauri/resources/sovereign-setup-signed.pkg

# 2. Update tauri.conf.json to use signed .pkg

# 3. Build and sign the app (Tauri handles app signing)
npm run tauri build -- --bundles dmg

# 4. Notarize the DMG
xcrun notarytool submit "Sovereign Stack.dmg" \
  --apple-id "..." --team-id "..." --password "..." --wait

# 5. Staple the notarization ticket
xcrun stapler staple "Sovereign Stack.dmg"
```

## What's NOT in Phase 1

Phase 1 is the **foundation**. The following are planned for future phases:

### Phase 2: Setup Wizard UI (~1 week)
- Multi-step wizard React components
- Progress tracking (0-100%)
- Dependency installation flow with progress bars
- API key input → macOS Keychain storage
- Ollama model pulling with live progress
- Error handling + retry logic

### Phase 3: Control Panel Dashboard (~1 week)
- Service status grid (green/red indicators)
- Start/stop/restart buttons per service
- Live log viewer (tail -f style)
- Configuration editor (API keys, ports, model selection)
- System health metrics

### Phase 4: Polish + Distribution (~1 week)
- Code signing automation
- Notarization CI pipeline
- DMG customization (background, icon layout)
- Auto-update via Tauri updater
- Comprehensive error handling
- Edge case testing

## Current Stack Context (Session 8)

This app is designed for the **current Sovereign Stack architecture** as of Session 8:

**What's IN the stack:**
- NanoClaw (WhatsApp agent with headless Chrome, WebSearch, Bash, gh CLI)
- LiteLLM (5 tiers: trivial, light, coder, medium, heavy → all Anthropic API)
- Ollama (only nomic-embed-text model, 274MB)
- memU (semantic memory with PostgreSQL + Temporal)
- AnythingLLM (RAG / document knowledge base)
- Docker Desktop (required for PostgreSQL, Temporal, AnythingLLM)

**What's NOT in the stack:**
- ~~Helix~~ (removed - agents run in NanoClaw containers)
- Large local models (32B+) - not viable on 16GB hardware
- Bundled runtimes (Node/Python/Docker) - installed via Homebrew

## License

This project is for the Sovereign Stack personal AI infrastructure.

## Next Steps

To continue development:

1. **Phase 2:** Build the Setup Wizard UI
   - Create React components for multi-step wizard
   - Wire up Rust commands to UI actions
   - Add progress tracking and error states

2. **Phase 3:** Build the Dashboard UI
   - Service status display
   - Control buttons
   - Log viewer
   - Settings panel

3. **Phase 4:** Production readiness
   - Set up Apple Developer certs
   - Implement signing + notarization
   - Configure auto-updater
   - Test on clean macOS install

---

Built with Tauri 2.0 🦀 React ⚛️ TypeScript 📘 Tailwind 🎨

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
