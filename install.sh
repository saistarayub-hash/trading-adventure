#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  Trading Companion — one-click install for macOS and Linux
#
#    ./install.sh                 install deps + create a launcher & menu entry
#    ./install.sh --installer     also build a real package (dmg / AppImage+deb)
#    ./install.sh --remove        undo the launcher & menu entry
#    ./install.sh --dry-run       print everything it would do, change nothing
#    ./install.sh --help
#
#  Nothing here needs root. Everything it creates lives in your home folder
#  (~/.local/bin and ~/.local/share/applications on Linux).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPANION_DIR="$HERE/companion"
LAUNCHER="$HOME/.local/bin/trading-companion"
DESKTOP="$HOME/.local/share/applications/trading-companion.desktop"
ICON="$COMPANION_DIR/icon256.png"

DRY=0
BUILD_INSTALLER=0
REMOVE=0

say()  { printf '\033[1;38;5;208m▸\033[0m %s\n' "$*"; }
info() { printf '  %s\n' "$*"; }
die()  { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

for arg in "$@"; do
  case "$arg" in
    --dry-run)    DRY=1 ;;
    --installer)  BUILD_INSTALLER=1 ;;
    --remove)     REMOVE=1 ;;
    --help|-h)
      sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) die "unknown option: $arg  (try --help)" ;;
  esac
done

run() {   # run "description" command...  — skipped in dry-run
  local desc="$1"; shift
  if [ "$DRY" = 1 ]; then say "[dry-run] $desc"; info "        $*"; return 0; fi
  say "$desc"
  "$@"
}

echo
echo "  🦊  Trading Companion — installer (macOS / Linux)"
echo "  ─────────────────────────────────────────────────"
echo

# ── 0. uninstall path ────────────────────────────────────────────────────────
if [ "$REMOVE" = 1 ]; then
  for f in "$LAUNCHER" "$DESKTOP"; do
    if [ -e "$f" ]; then run "remove $f" rm -f "$f"; else info "not present: $f"; fi
  done
  if command -v update-desktop-database >/dev/null 2>&1; then
    run "refresh the menu database" update-desktop-database "$HOME/.local/share/applications" || true
  fi
  say "done — your knowledge base (videos, notes, cards) was left untouched."
  exit 0
fi

# ── 1. prerequisites ─────────────────────────────────────────────────────────
command -v node >/dev/null 2>&1 || die "Node.js is not installed.
   macOS:  brew install node
   Linux:  sudo apt install nodejs npm   (or your distro's equivalent, v18+)
   Then run ./install.sh again."

NODE_MAJOR="$(node -v | sed 's/^v//' | cut -d. -f1)"
[ "$NODE_MAJOR" -ge 18 ] || die "Node.js v$NODE_MAJOR found, but v18 or newer is required (the engine uses the built-in fetch)."
info "node $(node -v), npm $(npm -v)"

[ -d "$COMPANION_DIR" ] || die "companion/ folder not found next to install.sh — run this script from the project folder."
[ -f "$HERE/companion.html" ] || die "This does not look like the project folder (companion.html missing)."

# ── 2. dependencies ──────────────────────────────────────────────────────────
run "install the Electron shell (one-off download, ~150 MB)" \
  npm --prefix "$COMPANION_DIR" install --no-audit --no-fund

# ── 3. launcher so it starts like any other app ──────────────────────────────
mkdir -p "$(dirname "$LAUNCHER")" 2>/dev/null || true
if [ "$DRY" = 1 ]; then
  say "[dry-run] write launcher → $LAUNCHER"
else
  say "write launcher → $LAUNCHER"
  cat > "$LAUNCHER" <<LAUNCH
#!/usr/bin/env bash
# Trading Companion launcher (created by install.sh)
cd "$COMPANION_DIR" || exit 1
exec npm start
LAUNCH
  chmod +x "$LAUNCHER"
fi
info "start it any time with:  trading-companion"

# ── 4. desktop integration ───────────────────────────────────────────────────
case "$(uname -s)" in
  Darwin)
    info "macOS: launch from Spotlight or run:  trading-companion"
    if [ "$BUILD_INSTALLER" = 1 ]; then
      run "build the .dmg installer" npm --prefix "$COMPANION_DIR" run dist:mac
      info "installer → companion/release/"
    fi
    ;;
  Linux)
    mkdir -p "$(dirname "$DESKTOP")" 2>/dev/null || true
    if [ "$DRY" = 1 ]; then
      say "[dry-run] write menu entry → $DESKTOP"
    else
      say "write menu entry → $DESKTOP"
      cat > "$DESKTOP" <<DESK
[Desktop Entry]
Type=Application
Name=Trading Companion
Comment=Always-on-top trading coach that learns from your videos and links
Exec=$LAUNCHER
Icon=$ICON
Terminal=false
Categories=Education;Finance;
StartupWMClass=trading-companion
DESK
      chmod +x "$DESKTOP" 2>/dev/null || true
    fi
    if command -v update-desktop-database >/dev/null 2>&1; then
      run "refresh the menu database" update-desktop-database "$HOME/.local/share/applications" || true
    fi
    if [ "$BUILD_INSTALLER" = 1 ]; then
      run "build the AppImage + .deb packages" npm --prefix "$COMPANION_DIR" run dist:linux
      info "packages → companion/release/"
    fi
    ;;
  *)
    info "unsupported OS for menu integration — the launcher above still works."
    ;;
esac

# ── 5. done ──────────────────────────────────────────────────────────────────
echo
say "installed. Three ways to start it:"
info "   1. trading-companion                 (the always-on-top panel)"
info "   2. cd companion && npm start         (same thing, from the repo)"
info "   3. node server.js → /companion       (browser, no Electron needed)"
echo
info "Optional starter library:   node tools/seed-demo.js"
info "Full guide:                 README-companion.md"
if [ "$DRY" = 1 ]; then echo; info "(dry run — nothing was changed)"; fi
echo
