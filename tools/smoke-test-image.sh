#!/bin/sh
# Start an image with throwaway secrets and check that it answers /health,
# runs as the non-root user and stops cleanly. No ports are published.
# Usage: tools/smoke-test-image.sh [image]   (default zorofin-companion:dev)
set -eu
image=${1:-zorofin-companion:dev}
name=zorofin-companion-smoke-$$
secret=$(od -An -tx1 -N32 /dev/urandom | tr -d ' \n')
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run -d --name "$name" -e ZOROFIN_BRIDGE_SECRET="$secret" -e ZOROFIN_MODULES= "$image" >/dev/null
for _ in $(seq 1 30); do
  if docker exec "$name" wget -qO- http://127.0.0.1:9310/health 2>/dev/null | grep -q '"status":"ok"'; then
    user=$(docker exec "$name" id -u)
    arch=$(docker exec "$name" uname -m)
    version=$(docker inspect -f '{{ index .Config.Labels "org.opencontainers.image.version" }}' "$image")
    if [ "$user" = 0 ]; then echo "FAIL: runs as root" >&2; exit 1; fi
    docker stop -t 10 "$name" >/dev/null
    code=$(docker inspect -f '{{.State.ExitCode}}' "$name")
    if [ "$code" != 0 ]; then echo "FAIL: exited with $code on stop" >&2; exit 1; fi
    echo "ok: $image ($arch, version $version) answers /health as uid $user and stops cleanly"
    exit 0
  fi
  sleep 1
done
echo "FAIL: no /health answer within 30 s" >&2
docker logs "$name" >&2 || true
exit 1
