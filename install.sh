#!/bin/sh
# Installs the explain-change binary and its agent skills. No runtime needed. The binary must match the SHA256SUMS
# of its release.
#
#   curl -fsSL https://raw.githubusercontent.com/denjamio/explain-change/main/install.sh | sh
#
# EXPLAIN_CHANGE_VERSION=v0.3.0 picks a release (default: the latest); EXPLAIN_CHANGE_BIN the folder (~/.local/bin).
set -eu

repo="denjamio/explain-change"
bin="${EXPLAIN_CHANGE_BIN:-$HOME/.local/bin}"
releases="${EXPLAIN_CHANGE_RELEASES:-https://github.com/$repo/releases}"
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
  dir="$releases/download/$EXPLAIN_CHANGE_VERSION"
else
  dir="$releases/latest/download"
fi
url="$dir/$asset"
if command -v sha256sum >/dev/null 2>&1; then sha256="sha256sum"
elif command -v shasum >/dev/null 2>&1; then sha256="shasum -a 256"
else echo "explain-change: sha256sum or shasum is needed to check the download" >&2; exit 1
fi
fetch() { if command -v curl >/dev/null 2>&1; then curl -fsSL "$1" -o "$2"; else wget -qO "$2" "$1"; fi; }

mkdir -p "$bin"
tmp="$bin/.explain-change.$$"
sums="$tmp.sums"
trap 'rm -f "$tmp" "$sums"' EXIT
echo "explain-change: downloading $url"
fetch "$url" "$tmp"
fetch "$dir/SHA256SUMS" "$sums"
expected=$(awk -v f="$asset" '$2 == f || $2 == "*" f { print tolower($1) }' "$sums")
actual=$($sha256 "$tmp" | awk '{ print tolower($1) }')
if [ -z "$expected" ] || [ "$expected" != "$actual" ]; then
  echo "explain-change: $asset does not match the release's SHA256SUMS (expected ${expected:-nothing}, got $actual)" >&2
  exit 1
fi
chmod +x "$tmp"
"$tmp" --version >/dev/null
mv "$tmp" "$bin/explain-change"
rm -f "$sums"
trap - EXIT
"$bin/explain-change" --version
"$bin/explain-change" install

case ":$PATH:" in
  *":$bin:"*) ;;
  *) echo "note: add $bin to your PATH, for example: echo 'export PATH=\"$bin:\$PATH\"' >> ~/.profile" ;;
esac
