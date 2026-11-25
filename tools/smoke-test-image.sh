#!/bin/sh
# Start an image with throwaway secrets and check that it answers /health,
# runs as a non-root user and stops cleanly. Runs twice: with the defaults
# (uid 1000) and the way NAS app stores start it (PUID=99, PGID=100, a
# root-owned folder mounted on /data). No ports are published.
# Usage: tools/smoke-test-image.sh [image]   (default zorofin-companion:dev)
set -eu
image=${1:-zorofin-companion:dev}
name=zorofin-companion-smoke-$$
secret=$(od -An -tx1 -N32 /dev/urandom | tr -d ' \n')
datadir=$(mktemp -d)
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; rm -rf "$datadir" 2>/dev/null || true; }
trap cleanup EXIT

# check <expected uid> <docker run options...>
check() {
  want=$1; shift
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker run -d --name "$name" -e ZOROFIN_BRIDGE_SECRET="$secret" -e ZOROFIN_MODULES= "$@" "$image" >/dev/null
  for _ in $(seq 1 30); do
    if docker exec "$name" wget -qO- http://127.0.0.1:9310/health 2>/dev/null | grep -q '"status":"ok"'; then
      # The companion is PID 1 after the entrypoint drops privileges.
      user=$(docker exec "$name" stat -c %u /proc/1)
      arch=$(docker exec "$name" uname -m)
      version=$(docker inspect -f '{{ index .Config.Labels "org.opencontainers.image.version" }}' "$image")
      if [ "$user" = 0 ]; then echo "FAIL: runs as root" >&2; exit 1; fi
      if [ "$user" != "$want" ]; then echo "FAIL: runs as uid $user, expected $want" >&2; exit 1; fi
      if ! docker exec -u "$user" "$name" sh -c 'touch /data/.smoke && rm /data/.smoke'; then
        echo "FAIL: /data is not writable by uid $user" >&2; exit 1
      fi
      docker stop -t 10 "$name" >/dev/null
      code=$(docker inspect -f '{{.State.ExitCode}}' "$name")
      if [ "$code" != 0 ]; then echo "FAIL: exited with $code on stop" >&2; exit 1; fi
      echo "ok: $image ($arch, version $version) answers /health as uid $user, can write /data and stops cleanly"
      return 0
    fi
    sleep 1
  done
  echo "FAIL: no /health answer within 30 s" >&2
  docker logs "$name" >&2 || true
  exit 1
}

check 1000
# Like Unraid: PUID/PGID 99:100 and a host folder (mode 700) owned by someone else.
check 99 -e PUID=99 -e PGID=100 -v "$datadir:/data"
