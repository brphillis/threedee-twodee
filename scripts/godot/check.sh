#!/bin/sh
# Verify a td2d godot-spriteframes export with a real, headless Godot 4.
#   scripts/godot/check.sh <sheets directory> <name>
# Downloads Godot 4.7.2 for Linux (run it in the Playwright Linux image, or any Linux with
# curl and unzip), imports the sheet images into a throwaway project, loads <name>.tres and
# prints every animation with its frame count, speed, loop flag and first-frame region.
set -eu
SHEETS=$1
NAME=$2
VERSION=4.7.2-stable
ARCH=$(uname -m)
case "$ARCH" in
  aarch64 | arm64) FILE=Godot_v${VERSION}_linux.arm64 ;;
  *) FILE=Godot_v${VERSION}_linux.x86_64 ;;
esac
WORK=$(mktemp -d)
cd "$WORK"
curl -sSL -o godot.zip "https://github.com/godotengine/godot/releases/download/${VERSION}/${FILE}.zip"
unzip -q godot.zip
mkdir project
printf 'config_version=5\n\n[application]\nconfig/name="td2d check"\n' > project/project.godot
cp "$SHEETS"/*.png "$SHEETS/$NAME.tres" project/
cp "$(dirname "$0")/check.gd" project/check.gd 2>/dev/null || cp /check.gd project/check.gd
./"$FILE" --headless --path project --import >/dev/null 2>&1 || true
TD2D_TRES="res://$NAME.tres" ./"$FILE" --headless --path project --script res://check.gd
