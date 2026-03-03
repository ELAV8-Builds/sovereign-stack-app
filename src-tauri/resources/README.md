# Sovereign Stack Resources

This directory contains embedded resources for the Tauri app.

## sovereign-setup.pkg

The privileged installer package (`sovereign-setup.pkg`) must be built on macOS using the provided `build-pkg.sh` script.

### Building the .pkg on macOS:

```bash
# From the project root
./build-pkg.sh
```

This will:
1. Create a component package with the postinstall script from `pkg-scripts/`
2. Build the final product package
3. Place it in `src-tauri/resources/sovereign-setup.pkg`

### Signing the .pkg (required for distribution):

```bash
productsign --sign "Developer ID Installer: Your Name" \
  src-tauri/resources/sovereign-setup.pkg \
  src-tauri/resources/sovereign-setup-signed.pkg
```

Then update `tauri.conf.json` to reference the signed version.

### What the .pkg does:

The postinstall script (`pkg-scripts/postinstall`) runs as root and:
- Creates the `sovereign` user with sysadminctl
- Creates `/Users/sovereign/sovereign-stack/` directory structure
- Sets up `/Users/Shared/sovereign-deploy/` bridge directory
- Configures macOS power settings (prevent sleep)
- Enables firewall + stealth mode
- Disables mDNS advertising
- Creates Docker socket helper LaunchDaemon

### Development Note:

For development/testing without building the .pkg, you can create a placeholder:

```bash
touch src-tauri/resources/sovereign-setup.pkg
```

The Tauri app will still build, but the privileged installer feature will not work until you build a real .pkg on macOS.
