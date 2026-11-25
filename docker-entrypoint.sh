#!/bin/sh
# Starts the companion as a non-root user.
#
# Started as root (the default, and what NAS app stores do), it makes the data
# folder writable for PUID:PGID (default 1000:1000, the image's "node" user)
# and drops to that user. Unraid uses 99:100 and TrueNAS 568:568. Started with
# --user, it runs as that user and leaves the data folder's owner alone.
#
# With no bridge secret set (ZOROFIN_BRIDGE_SECRET or ZOROFIN_BRIDGE_SECRET_FILE),
# it creates one in the data folder on first start and prints it once, so a
# one-click install works; paste it into the Zorofin plugin's Companion secret.
set -eu
data=${ZOROFIN_DATA_DIR:-/data}
mkdir -p "$data" 2>/dev/null || true

if [ -z "${ZOROFIN_BRIDGE_SECRET:-}" ] && [ -z "${ZOROFIN_BRIDGE_SECRET_FILE:-}" ]; then
  secret_file="$data/bridge-secret"
  if [ ! -s "$secret_file" ]; then
    (umask 077 && od -An -tx1 -N32 /dev/urandom | tr -d ' \n' > "$secret_file")
    echo "zorofin-companion: created a bridge secret in $secret_file (the companion's data folder)."
    echo "zorofin-companion: paste it into Jellyfin, Dashboard > Plugins > Zorofin > Companion secret:"
    echo "zorofin-companion: $(cat "$secret_file")"
  fi
  export ZOROFIN_BRIDGE_SECRET_FILE="$secret_file"
fi

if [ "$(id -u)" = 0 ]; then
  uid=${PUID:-1000}
  gid=${PGID:-1000}
  if [ "$uid" = 0 ]; then
    echo "zorofin-companion: PUID=0 is not allowed; set PUID to a non-root user" >&2
    exit 78
  fi
  # Only files with another owner are changed, so restarts stay fast.
  find "$data" \( ! -user "$uid" -o ! -group "$gid" \) -exec chown "$uid:$gid" {} + 2>/dev/null ||
    echo "zorofin-companion: could not hand $data to $uid:$gid; it must be writable by that user" >&2
  exec su-exec "$uid:$gid" "$@"
fi
exec "$@"
