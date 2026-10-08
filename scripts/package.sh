#!/bin/sh
# Builds the store uploads in dist/:
#   basic-autocorrect-<version>.zip         the extension (same zip for Firefox and Chrome)
#   basic-autocorrect-<version>-source.zip  source for Mozilla's reviewers (the word data is generated)
set -e
cd "$(dirname "$0")/.."
VERSION=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' manifest.json | head -1)
OUT="dist/basic-autocorrect-$VERSION.zip"
SRC="dist/basic-autocorrect-$VERSION-source.zip"
mkdir -p dist
rm -f "$OUT" "$SRC"
zip -qr "$OUT" manifest.json icons/*.png src LICENSE NOTICE.md -x '*.DS_Store'
zip -qr "$SRC" manifest.json icons src scripts test store package.json README.md PUBLISHING.md LICENSE NOTICE.md \
  -x '*.DS_Store' 'store/*.png'
echo "$OUT"
echo "$SRC"
