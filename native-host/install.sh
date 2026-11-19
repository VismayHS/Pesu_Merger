#!/usr/bin/env bash
# Sets up the PESU Downloader converter for the current user on macOS and Linux, all in one go:
#   1. checks for Python 3, and offers to install it if it is missing
#   2. copies the helper to a folder the browser is allowed to run it from, and registers it with every
#      supported browser (Chrome, Brave, Edge, Chromium, Vivaldi, Arc, Firefox)
#   3. checks for LibreOffice, and offers to install it (free) if it is missing
#   4. tests the helper the way the browser starts it
# On a Mac without Homebrew it downloads Python and LibreOffice from their official websites (or uses a
# LibreOffice .dmg already in Downloads) and checks their signatures before installing.
# Safe to run again at any time (e.g. after updating PESU Downloader).
#
#   bash install.sh             asks before installing anything
#   bash install.sh --yes       installs whatever is missing without asking
#   bash install.sh --dry-run   only reports what it finds and what it would install; changes nothing
#   bash install.sh <ext-id>    if you changed the extension's key
set -uo pipefail

EXT_ID="cooigkfjkkbolfcfcdmbmdjpmbmlofab"
FIREFOX_ID="pesu-downloader@vismayhs"
HOST_NAME="com.pesu.downloader"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ASSUME_YES=0
DRY_RUN=0
for a in "$@"; do
  case "$a" in
    -y|--yes) ASSUME_YES=1 ;;
    --dry-run) DRY_RUN=1 ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    -*) echo "Unknown option: $a (try --help)"; exit 64 ;;
    *) EXT_ID="$a" ;;
  esac
done

c_ok=$'\033[32m'; c_warn=$'\033[33m'; c_err=$'\033[31m'; c_info=$'\033[36m'; c_off=$'\033[0m'
OS="$(uname -s)"
IS_MAC=0; [ "$OS" = "Darwin" ] && IS_MAC=1

ask() {
  [ "$ASSUME_YES" = 1 ] && return 0
  if [ ! -t 0 ]; then
    echo "  (Not asking because this isn't an interactive terminal. Run it again with --yes to install automatically.)"
    return 1
  fi
  local reply
  read -r -p "  $1 [Y/n] " reply || return 1
  case "$reply" in ""|y|Y|yes|Yes|YES) return 0 ;; *) return 1 ;; esac
}

open_page() {
  if [ "$DRY_RUN" = 1 ]; then echo "  ${c_info}[dry run] would open $1${c_off}"; return; fi
  if [ "$IS_MAC" = 1 ]; then open "$1" >/dev/null 2>&1 || true
  else xdg-open "$1" >/dev/null 2>&1 & fi
}

# The system's package manager (Linux) and its package names
PM=""
if [ "$IS_MAC" = 1 ]; then
  for b in brew /opt/homebrew/bin/brew /usr/local/bin/brew; do
    if command -v "$b" >/dev/null 2>&1; then PM="$(command -v "$b")"; break; fi
  done
else
  for m in apt-get dnf pacman zypper; do
    if command -v "$m" >/dev/null 2>&1; then PM="$m"; break; fi
  done
fi
pm_command() { # $1 = python | libreoffice -> prints the install command
  case "$PM:$1" in
    *brew:python) echo "$PM install python" ;;
    *brew:libreoffice) echo "$PM install --cask libreoffice" ;;
    apt-get:python) echo "sudo apt-get install -y python3" ;;
    apt-get:libreoffice) echo "sudo apt-get install -y libreoffice-impress libreoffice-writer libreoffice-calc" ;;
    dnf:python) echo "sudo dnf install -y python3" ;;
    dnf:libreoffice) echo "sudo dnf install -y libreoffice-impress libreoffice-writer libreoffice-calc" ;;
    pacman:python) echo "sudo pacman -S --needed --noconfirm python" ;;
    pacman:libreoffice) echo "sudo pacman -S --needed --noconfirm libreoffice-fresh" ;;
    zypper:python) echo "sudo zypper install -y python3" ;;
    zypper:libreoffice) echo "sudo zypper install -y libreoffice-impress libreoffice-writer libreoffice-calc" ;;
  esac
}
# ---- Mac without Homebrew: download from the official website, check the signature, install.
is_apple_silicon() { [ "$(sysctl -n hw.optional.arm64 2>/dev/null)" = 1 ]; } # true even under Rosetta
# A LibreOffice .dmg for this Mac that was downloaded but never installed (newest first)
find_lo_dmg() {
  local a f; if is_apple_silicon; then a="aarch64"; else a="x86-64"; fi
  while IFS= read -r f; do
    case "$f" in *langpack*|*sdk*|*helppack*) continue ;; esac
    echo "$f"; return 0
  done < <(ls -t "$HOME/Downloads"/LibreOffice_*_MacOS_"$a"*.dmg 2>/dev/null)
  return 1
}
lo_latest_url() {
  local base="https://download.documentfoundation.org/libreoffice/stable" v
  v="$(curl -fsSL --max-time 30 "$base/" | grep -o 'href="[0-9][0-9.]*/"' | sed 's/^href="//; s/\/"$//' \
       | sort -t. -k1,1n -k2,2n -k3,3n | tail -1)"
  [ -n "$v" ] || return 1
  if is_apple_silicon; then echo "$base/$v/mac/aarch64/LibreOffice_${v}_MacOS_aarch64.dmg"
  else echo "$base/$v/mac/x86_64/LibreOffice_${v}_MacOS_x86-64.dmg"; fi
}
py_latest_url() {
  curl -fsSL --max-time 30 "https://www.python.org/downloads/macos/" \
    | grep -o 'https://www.python.org/ftp/python/3\.[0-9.]*/python-3\.[0-9.]*-macos11\.pkg' | sort -u \
    | sed 's#^.*/python-\([0-9.]*\)-macos11\.pkg$#\1 &#' | sort -t. -k1,1n -k2,2n -k3,3n | tail -1 | cut -d' ' -f2
}
# Copies LibreOffice.app from a .dmg into /Applications, but only if it is genuine: signed by
# The Document Foundation and notarized by Apple.
install_lo_dmg() {
  local dmg="$1" mnt app ok=1
  mnt="$(mktemp -d /tmp/pesu-lo.XXXXXX)"
  if ! hdiutil attach -nobrowse -readonly -noautoopen -mountpoint "$mnt" "$dmg" >/dev/null 2>&1; then
    echo "  ${c_warn}Couldn't open $(basename "$dmg"). The download may be incomplete.${c_off}"
    rmdir "$mnt" 2>/dev/null; return 1
  fi
  app="$mnt/LibreOffice.app"
  echo "  Checking that it's the genuine LibreOffice..."
  if [ ! -d "$app" ]; then
    echo "  ${c_warn}That file doesn't contain LibreOffice.app.${c_off}"; ok=0
  elif ! codesign -dv --verbose=2 "$app" 2>&1 | grep -q 'Authority=Developer ID Application: The Document Foundation' \
       || ! spctl --assess --type execute "$app" >/dev/null 2>&1; then
    echo "  ${c_err}It isn't signed by The Document Foundation, so it was NOT installed.${c_off}"; ok=0
  else
    echo "  Copying LibreOffice into Applications (about a minute)..."
    if ! ditto "$app" "/Applications/LibreOffice.app" 2>/dev/null; then
      echo "  Your Mac's password is needed to add it to Applications."
      sudo ditto "$app" "/Applications/LibreOffice.app" || ok=0
    fi
    # Its signature was checked above, so drop the "downloaded from the internet" flag: otherwise macOS
    # may hold the first (invisible) conversion behind an "Are you sure you want to open it?" dialog.
    [ "$ok" = 1 ] && { xattr -dr com.apple.quarantine "/Applications/LibreOffice.app" 2>/dev/null \
      || sudo xattr -dr com.apple.quarantine "/Applications/LibreOffice.app" 2>/dev/null || true; }
  fi
  hdiutil detach -quiet "$mnt" 2>/dev/null || hdiutil detach -force -quiet "$mnt" 2>/dev/null
  rmdir "$mnt" 2>/dev/null
  [ "$ok" = 1 ] && echo "  ${c_ok}LibreOffice is now in Applications.${c_off}"
  [ "$ok" = 1 ]
}
install_py_pkg() {
  local pkg="$1"
  if ! pkgutil --check-signature "$pkg" 2>/dev/null | grep -q 'Developer ID Installer: Python Software Foundation'; then
    echo "  ${c_err}That installer isn't signed by the Python Software Foundation, so it was NOT installed.${c_off}"
    return 1
  fi
  echo "  Your Mac's password is needed to install Python."
  sudo installer -pkg "$pkg" -target / >/dev/null
}
mac_offer_download() { # $1 = python | libreoffice. Returns 0 if it tried to install.
  local what="$1" label="$2" size="$3" file="" url tmp
  [ "$what" = libreoffice ] && file="$(find_lo_dmg || true)"
  if [ -n "$file" ]; then
    echo "  Found a LibreOffice download that was never installed: $file"
    if [ "$DRY_RUN" = 1 ]; then echo "  ${c_info}[dry run] would offer to install it into Applications${c_off}"; return 1; fi
    ask "Install it into Applications now?" || return 1
    install_lo_dmg "$file"
    return 0
  fi
  if [ "$DRY_RUN" = 1 ]; then echo "  ${c_info}[dry run] would offer to download $label ($size) from its official website and install it${c_off}"; return 1; fi
  ask "Download $label from its official website and install it now? It's free ($size)." || return 1
  if [ "$what" = libreoffice ]; then url="$(lo_latest_url || true)"; else url="$(py_latest_url || true)"; fi
  if [ -z "$url" ]; then echo "  ${c_warn}Couldn't reach the $label website. Check your internet connection.${c_off}"; return 1; fi
  tmp="$(mktemp -d /tmp/pesu-dl.XXXXXX)"
  file="$tmp/$(basename "$url")"
  echo "  Downloading $(basename "$url")... Please don't close this window."
  if curl -fL --progress-bar --retry 3 -o "$file" "$url"; then
    if [ "$what" = libreoffice ]; then install_lo_dmg "$file"; else install_py_pkg "$file"; fi
  else
    echo "  ${c_warn}The download didn't finish.${c_off}"
  fi
  rm -rf "$tmp"
  return 0
}

# Offers to install $1 (python | libreoffice). Returns 0 if it ran the install.
offer_install() {
  local what="$1" label="$2" size="$3" cmd
  cmd="$(pm_command "$what")"
  if [ -z "$cmd" ] && [ "$IS_MAC" = 1 ]; then
    echo "  (Homebrew isn't installed, so it will come from the official website instead.)"
    mac_offer_download "$what" "$label" "$size"
    return
  fi
  if [ -z "$cmd" ]; then
    echo "  (No supported package manager found, so $label can't be installed automatically.)"
    return 1
  fi
  if [ "$DRY_RUN" = 1 ]; then echo "  ${c_info}[dry run] would offer to install $label ($size): $cmd${c_off}"; return 1; fi
  local note=""
  case "$cmd" in sudo*) note=" Your computer's password will be asked." ;; esac
  ask "Install $label now? It's free ($size).$note" || return 1
  echo "  Installing $label... this can take a few minutes. Please don't close this window."
  # shellcheck disable=SC2086
  $cmd || echo "  ${c_warn}The installation didn't finish.${c_off}"
  return 0
}

find_python() { # Python 3.8+ as an absolute path (browsers start the helper with a minimal PATH)
  local cand p
  for cand in python3 python /opt/homebrew/bin/python3 /usr/local/bin/python3 /usr/bin/python3 \
              /Library/Frameworks/Python.framework/Versions/Current/bin/python3; do
    if command -v "$cand" >/dev/null 2>&1; then
      p="$(command -v "$cand")"
      # A Mac's /usr/bin/python3 is only a stub until Apple's developer tools are installed:
      # running it pops up an install dialog, so skip it then.
      if [ "$IS_MAC" = 1 ] && [ "$p" = /usr/bin/python3 ] && ! xcode-select -p >/dev/null 2>&1; then continue; fi
      if "$p" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)' >/dev/null 2>&1; then
        "$p" -c 'import sys; print(sys.executable)'
        return 0
      fi
    fi
  done
  return 1
}

# Asks the helper what it can do; sets ST_OK, ST_LO (LibreOffice path) and ST_ERR.
self_test() {
  local json
  if [ -n "${1:-}" ]; then json="$("$PY" "$HERE/selftest.py" "$1" 2>/dev/null)"; else json="$("$PY" "$HERE/selftest.py" 2>/dev/null)"; fi
  read_field() { "$PY" -c 'import json,sys
try: d = json.loads(sys.argv[1])
except Exception: d = {"error": "the self-test could not run"}
v = d.get(sys.argv[2], "")
print("1" if v is True else ("" if v in (False, None) else v))' "$json" "$1"; }
  ST_OK="$(read_field ok)"; ST_LO="$(read_field libreoffice)"; ST_ERR="$(read_field error)"
}

echo
echo "${c_info}PESU Downloader - setting up the converter${c_off}"
[ "$DRY_RUN" = 1 ] && echo "${c_info}(dry run: nothing will be installed or changed)${c_off}"
echo

# ---------------------------------------------------------------- 1. Python
PY="$(find_python || true)"
if [ -z "$PY" ]; then
  echo "  ${c_warn}Python:      not found${c_off}"
  echo "  The converter needs Python 3 (free) to run."
  if offer_install python "Python 3" "about 50 MB"; then PY="$(find_python || true)"; fi
  if [ -z "$PY" ]; then
    echo
    echo "${c_err}NOT FINISHED: Python is needed.${c_off}"
    if [ "$IS_MAC" = 1 ]; then
      open_page "https://www.python.org/downloads/"
      echo "  1. On the python.org page, click \"Download Python 3\", open the file and click Continue, then Install."
      echo "  2. Run this installer again."
    else
      echo "  Install it with your package manager, e.g.  sudo apt install python3   then run this installer again."
    fi
    exit 1
  fi
fi
echo "  Python:      $PY"

# ---------------------------------------------------------------- 2. register the helper
# The browser starts the helper itself, so it must live where the browser may run it. macOS blocks apps
# from reading the Desktop, Documents and Downloads folders (the browser then just can't start it), so the
# helper is copied out of the project folder. This also keeps it working if the project folder is moved.
if [ "$IS_MAC" = 1 ]; then APP_DIR="$HOME/Library/Application Support/PESUDownloader/native-host"
else APP_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/pesu-downloader/native-host"; fi
LAUNCHER="$APP_DIR/run_host.sh"
if [ "$DRY_RUN" = 1 ]; then
  echo "  ${c_info}[dry run] would register the helper for Chrome, Brave, Edge, Chromium, Vivaldi, Arc and Firefox${c_off}"
else
  # optional library that repairs damaged or locked PDFs (best effort, never fatal)
  if ! "$PY" -c 'import pypdf' >/dev/null 2>&1; then
    echo "  Installing pypdf (optional, repairs damaged PDFs)..."
    "$PY" -m pip install --user --quiet pypdf >/dev/null 2>&1 \
      || "$PY" -m pip install --user --quiet --break-system-packages pypdf >/dev/null 2>&1 \
      || echo "  (skipped - optional)"
  fi

  set -e
  mkdir -p "$APP_DIR"
  if [ "$HERE" != "$APP_DIR" ]; then
    cp -f "$HERE/pesu_host.py" "$HERE/selftest.py" "$HERE/install.sh" "$HERE/uninstall.sh" "$APP_DIR/"
  fi
  rm -rf "$APP_DIR/__pycache__"
  cat > "$LAUNCHER" <<EOF
#!/bin/sh
# Generated by install.sh - starts the PESU Downloader helper.
exec "$PY" -u "$APP_DIR/pesu_host.py" "\$@"
EOF
  chmod +x "$LAUNCHER" "$APP_DIR/pesu_host.py"
  echo "  Helper:      $APP_DIR"

  esc() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }
  MANIFEST_JSON=$(cat <<EOF
{
  "name": "$HOST_NAME",
  "description": "PESU Downloader converter helper",
  "path": "$(esc "$LAUNCHER")",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXT_ID/"]
}
EOF
)
  if [ "$IS_MAC" = 1 ]; then
    B="$HOME/Library/Application Support"
    DIRS=(
      "$B/Google/Chrome" "$B/Google/Chrome Beta" "$B/Google/Chrome Canary" "$B/Chromium"
      "$B/BraveSoftware/Brave-Browser" "$B/Microsoft Edge" "$B/Vivaldi" "$B/Arc/User Data"
    )
  else
    C="${XDG_CONFIG_HOME:-$HOME/.config}"
    DIRS=(
      "$C/google-chrome" "$C/google-chrome-beta" "$C/google-chrome-unstable" "$C/chromium"
      "$C/BraveSoftware/Brave-Browser" "$C/microsoft-edge" "$C/vivaldi"
    )
  fi
  for d in "${DIRS[@]}"; do
    # Install where the browser exists; always install for Google Chrome so a later install works too.
    if [ -d "$d" ] || [ "$d" = "${DIRS[0]}" ]; then
      mkdir -p "$d/NativeMessagingHosts"
      printf '%s\n' "$MANIFEST_JSON" > "$d/NativeMessagingHosts/$HOST_NAME.json"
      echo "  Registered:  $d"
    fi
  done
  printf '%s\n' "$MANIFEST_JSON" > "$APP_DIR/$HOST_NAME.json"

  # Firefox identifies extensions by add-on id ("allowed_extensions") and has its own folder
  FF_JSON=$(cat <<EOF
{
  "name": "$HOST_NAME",
  "description": "PESU Downloader converter helper",
  "path": "$(esc "$LAUNCHER")",
  "type": "stdio",
  "allowed_extensions": ["$FIREFOX_ID"]
}
EOF
)
  if [ "$IS_MAC" = 1 ]; then FF_DIR="$HOME/Library/Application Support/Mozilla/NativeMessagingHosts"; else FF_DIR="$HOME/.mozilla/native-messaging-hosts"; fi
  mkdir -p "$FF_DIR"
  printf '%s\n' "$FF_JSON" > "$FF_DIR/$HOST_NAME.json"
  echo "  Registered:  $FF_DIR (Firefox)"
  set +e
fi

# ---------------------------------------------------------------- 3. LibreOffice + self-test
TEST_WITH=""; [ "$DRY_RUN" = 1 ] || TEST_WITH="$LAUNCHER"
self_test "$TEST_WITH"
if [ "$ST_OK" != 1 ]; then
  echo
  echo "${c_err}NOT FINISHED: the helper didn't start (${ST_ERR:-unknown error}).${c_off}"
  echo "  Look at ~/.cache/pesu-downloader/host.log (Linux) or ~/Library/Application Support/PESUDownloader/host.log (macOS),"
  echo "  or open an issue on GitHub with this window's text."
  exit 3
fi
if [ -z "$ST_LO" ]; then
  echo "  ${c_warn}LibreOffice: not found${c_off}"
  echo "  Most PESU courses have PowerPoint and Word files. To turn them into PDF the converter needs"
  echo "  LibreOffice (free). On a Mac it's needed even if you have Microsoft Office."
  if offer_install libreoffice "LibreOffice" "about 350 MB download"; then self_test "$TEST_WITH"; fi
  if [ -z "$ST_LO" ]; then
    open_page "https://www.libreoffice.org/download/download-libreoffice/"
    echo
    echo "${c_err}NOT FINISHED: install LibreOffice.${c_off}"
    if [ "$IS_MAC" = 1 ]; then
      echo "  1. On the LibreOffice page, pick macOS (Apple Silicon for M chips, x86_64 for Intel) and click Download."
      echo "  2. Open the downloaded file and DRAG LibreOffice INTO Applications. Downloading alone isn't enough."
      echo "  3. Run this installer again. (Or just run it again now: it finds the download and installs it for you.)"
    else
      echo "  Install it with your package manager, e.g.  sudo apt install libreoffice"
      echo "  Then press Re-check in PESU Downloader."
    fi
    exit 2
  fi
fi
echo "  ${c_ok}Converter:   LibreOffice ($ST_LO)${c_off}"
echo "  Self-test:   OK"
echo
if [ "$DRY_RUN" = 1 ]; then
  echo "${c_ok}Dry run finished: everything needed is already on this computer.${c_off}"
else
  echo "${c_ok}ALL SET!${c_off}"
  if [ "$IS_MAC" = 1 ]; then
    echo "  1. Quit your browser completely with Cmd+Q (closing its window isn't enough) and open it again."
  else
    echo "  1. Close every browser window and open the browser again."
  fi
  echo "  2. Open PESU Downloader. The top-right corner should say: Converter: LibreOffice"
  echo "  Use more than one browser profile? Add the extension in each profile you use PESU in."
  echo "  The converter already works for all of them."
fi
