#!/bin/bash
# hdiutil 直出 DMG（tauri 自带 bundle_dmg.sh 依赖 Finder AppleScript，无人值守下不可靠）
set -euo pipefail
cd "$(dirname "$0")/.."
BUNDLE="src-tauri/target/release/bundle"
APP="$BUNDLE/macos/agent-cli-contact.app"
OUT="$BUNDLE/dmg/agent-cli-contact_0.1.0_aarch64.dmg"
[ -d "$APP" ] || { echo "缺少 $APP，先跑 tauri build"; exit 1; }
mkdir -p "$BUNDLE/dmg"
STAGE=$(mktemp -d)
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
hdiutil create -volname "agent-cli-contact" -srcfolder "$STAGE" -ov -format UDZO "$OUT" >/dev/null
rm -rf "$STAGE"
echo "DMG: $OUT"
