#!/usr/bin/env bash
# Runs a command in CI; when it fails, its last lines become a public annotation (readable without signing in).
#   scripts/ci-run.sh <title> <command…>
title="$1"; shift
log="$(mktemp)"
"$@" 2>&1 | tee "$log"
status=${PIPESTATUS[0]}
if [ "$status" -ne 0 ]; then
  tail -n 60 "$log" | cut -c1-300 | awk -v t="$title" 'BEGIN { printf "::error title=%s::", t } { gsub(/%/, "%25"); printf "%s%%0A", $0 } END { print "" }'
fi
exit "$status"
