#!/usr/bin/env bash
# Removes the PESU Downloader helper (macOS / Linux): its browser registrations and the copy install.sh made.
set -u
HOST_NAME="com.pesu.downloader"
if [ "$(uname -s)" = "Darwin" ]; then
  ROOT="$HOME/Library/Application Support"
  APP_DIR="$ROOT/PESUDownloader/native-host"
else
  ROOT="${XDG_CONFIG_HOME:-$HOME/.config}"
  APP_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/pesu-downloader/native-host"
fi
find "$ROOT" -maxdepth 4 -path "*NativeMessagingHosts/$HOST_NAME.json" -print -delete 2>/dev/null
rm -fv "$HOME/Library/Application Support/Mozilla/NativeMessagingHosts/$HOST_NAME.json" "$HOME/.mozilla/native-messaging-hosts/$HOST_NAME.json" 2>/dev/null
if [ -d "$APP_DIR" ]; then rm -rf "$APP_DIR" && echo "removed $APP_DIR"; fi
echo "PESU Downloader helper unregistered."
