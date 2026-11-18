#!/usr/bin/env bash
# Removes the PESU Downloader helper registration (macOS / Linux).
set -u
HOST_NAME="com.pesu.downloader"
if [ "$(uname -s)" = "Darwin" ]; then
  ROOT="$HOME/Library/Application Support"
else
  ROOT="${XDG_CONFIG_HOME:-$HOME/.config}"
fi
find "$ROOT" -maxdepth 4 -path "*NativeMessagingHosts/$HOST_NAME.json" -print -delete 2>/dev/null
rm -fv "$HOME/Library/Application Support/Mozilla/NativeMessagingHosts/$HOST_NAME.json" "$HOME/.mozilla/native-messaging-hosts/$HOST_NAME.json" 2>/dev/null
echo "PESU Downloader helper unregistered."
