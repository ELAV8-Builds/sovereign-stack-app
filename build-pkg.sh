#!/bin/bash
#
# Build the privileged installer .pkg
# This creates a signed .pkg that the Tauri app can invoke to perform root operations

set -e

PKG_IDENTIFIER="com.sovereign.setup"
PKG_VERSION="1.0.0"
SCRIPTS_DIR="pkg-scripts"
OUTPUT_DIR="src-tauri/resources"
COMPONENT_PKG="sovereign-setup-component.pkg"
FINAL_PKG="sovereign-setup.pkg"

echo "Building privileged installer package..."

# Create resources directory if it doesn't exist
mkdir -p "$OUTPUT_DIR"

# Step 1: Build component package (no payload, scripts only)
echo "Creating component package..."
pkgbuild \
    --nopayload \
    --scripts "$SCRIPTS_DIR" \
    --identifier "$PKG_IDENTIFIER" \
    --version "$PKG_VERSION" \
    "$COMPONENT_PKG"

# Step 2: Build product package
echo "Creating product package..."
productbuild \
    --package "$COMPONENT_PKG" \
    "$OUTPUT_DIR/$FINAL_PKG"

# Clean up intermediate file
rm "$COMPONENT_PKG"

echo "✓ Package built: $OUTPUT_DIR/$FINAL_PKG"
echo ""
echo "Note: This package is unsigned. For distribution, you'll need to sign it with:"
echo "  productsign --sign 'Developer ID Installer: Your Name' \\"
echo "    $OUTPUT_DIR/$FINAL_PKG $OUTPUT_DIR/${FINAL_PKG%.pkg}-signed.pkg"
echo ""
echo "The Tauri app will invoke this package during setup to:"
echo "  - Create the sovereign user"
echo "  - Set up directory structure"
echo "  - Configure macOS security settings"
echo "  - Enable firewall and stealth mode"

exit 0
