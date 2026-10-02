#!/bin/bash
# 編譯 Mac App：bash macapp/build.sh  → 產生 桌面/Serenity 追蹤.app
# 只有改 Swift 或圖示才要重編；改 Python / web 畫面，重開 App 就生效。
set -e
cd "$(dirname "$0")"
APP="${1:-$HOME/Desktop/Serenity 追蹤.app}"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Serenity 追蹤</string>
  <key>CFBundleDisplayName</key><string>Serenity 追蹤</string>
  <key>CFBundleIdentifier</key><string>local.serenity.tracker</string>
  <key>CFBundleExecutable</key><string>SerenityTracker</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>
PLIST

# 圖示
TMP=$(mktemp -d)
swift icon.swift "$TMP/icon-1024.png" >/dev/null
ICONSET="$TMP/AppIcon.iconset"; mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z $s $s "$TMP/icon-1024.png" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  d=$((s*2)); sips -z $d $d "$TMP/icon-1024.png" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"

# 編譯（Intel + Apple 晶片都能跑；一定要指定 macos13.0，不然新 SDK 會讓舊系統開不起來）
for arch in arm64 x86_64; do
  swiftc -O -target $arch-apple-macos13.0 -framework Cocoa -framework WebKit main.swift -o "$TMP/bin-$arch"
done
lipo -create "$TMP/bin-arm64" "$TMP/bin-x86_64" -output "$APP/Contents/MacOS/SerenityTracker"
codesign -s - --force --deep "$APP" 2>/dev/null || true
echo "完成：$APP"
