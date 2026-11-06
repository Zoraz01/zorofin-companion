#!/bin/sh
# Create the companion's secrets folder with fresh bridge and webhook secrets.
# Existing files are kept. Usage: tools/new-secrets.sh [secrets-dir]
set -eu
dir=${1:-"$(dirname "$0")/../secrets"}
mkdir -p "$dir"
chmod 700 "$dir"
for name in bridge-secret seerr-webhook-secret; do
  if [ ! -s "$dir/$name" ]; then
    (umask 077; od -An -tx1 -N32 /dev/urandom | tr -d ' \n' > "$dir/$name")
    echo "created $dir/$name"
  fi
done
# The container runs as uid 1000 (node) and must read these files. Docker
# Desktop maps ownership for you; on Linux, run as uid 1000 or as root.
if [ "$(id -u)" = 0 ]; then chown -R 1000:1000 "$dir"; fi
chmod 600 "$dir"/* 2>/dev/null || true
echo "Copy the bridge secret from $dir/bridge-secret into the Zorofin plugin settings."
echo "Add jellyfin-api-key and seerr-api-key files here for modules that need them."
