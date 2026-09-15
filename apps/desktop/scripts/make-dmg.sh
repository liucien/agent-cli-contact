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

# 产物汇总到仓库根 release/，避免埋在 target 深层目录
RELEASE="../../release"
rm -rf "$RELEASE/agent-cli-contact.app"
mkdir -p "$RELEASE"
cp -R "$APP" "$RELEASE/"
cp "$OUT" "$RELEASE/"
echo "产物已输出到 $(cd "$RELEASE" && pwd)："
ls -lh "$RELEASE" | awk 'NR>1 {print "  " $NF " (" $5 ")"}'
