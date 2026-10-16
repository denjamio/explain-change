#!/bin/sh
# Installs the explain-change binary and its agent skills. No runtime needed.
#
#   curl -fsSL https://raw.githubusercontent.com/denjamio/explain-change/main/install.sh | sh
#
# EXPLAIN_CHANGE_VERSION=v0.2.0 picks a release (default: the latest); EXPLAIN_CHANGE_BIN the folder (~/.local/bin).
set -eu

repo="denjamio/explain-change"
bin="${EXPLAIN_CHANGE_BIN:-$HOME/.local/bin}"
case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=darwin ;;
  *) echo "explain-change: no binary for $(uname -s); use npm: npm install -g explain-change" >&2; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch=x64 ;;
  arm64 | aarch64) arch=arm64 ;;
  *) echo "explain-change: no binary for $(uname -m); use npm: npm install -g explain-change" >&2; exit 1 ;;
esac
asset="explain-change-$os-$arch"
if [ -n "${EXPLAIN_CHANGE_VERSION:-}" ]; then
  url="https://github.com/$repo/releases/download/$EXPLAIN_CHANGE_VERSION/$asset"
else
  url="https://github.com/$repo/releases/latest/download/$asset"
fi

mkdir -p "$bin"
tmp="$bin/.explain-change.$$"
trap 'rm -f "$tmp"' EXIT
echo "explain-change: downloading $url"
if command -v curl >/dev/null 2>&1; then curl -fsSL "$url" -o "$tmp"; else wget -qO "$tmp" "$url"; fi
chmod +x "$tmp"
"$tmp" --version >/dev/null
mv "$tmp" "$bin/explain-change"
trap - EXIT
"$bin/explain-change" --version
"$bin/explain-change" install

case ":$PATH:" in
  *":$bin:"*) ;;
  *) echo "note: add $bin to your PATH, for example: echo 'export PATH=\"$bin:\$PATH\"' >> ~/.profile" ;;
esac
