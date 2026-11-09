#!/bin/sh
# Build the companion image for linux/amd64 and linux/arm64 and push it.
#
# The GitHub workflow (.github/workflows/companion-image.yml) does the same on
# every change to main and on companion-v* tags. Use this script when Actions
# can't run, or to publish from a workstation.
#
# Usage:
#   tools/publish-image.sh                 # push :edge and :sha-<commit>
#   tools/publish-image.sh --release       # also push :<package.json version> and :latest
#   tools/publish-image.sh --local         # build for this machine only and load it (no push)
#
# Environment:
#   ZOROFIN_COMPANION_REPOSITORY  image name (default ghcr.io/zoraz01/zorofin-companion)
#   PLATFORMS                     default linux/amd64,linux/arm64
#
# Pushing needs `docker login ghcr.io` with a token that has write:packages.
# Building arm64 on an amd64 host (or the reverse) needs QEMU binfmt, e.g.
# `docker run --privileged --rm tonistiigi/binfmt --install all`.
set -eu
cd "$(dirname "$0")/.."

repository=${ZOROFIN_COMPANION_REPOSITORY:-ghcr.io/zoraz01/zorofin-companion}
platforms=${PLATFORMS:-linux/amd64,linux/arm64}
version=$(node -p "require('./package.json').version")
revision=$(git rev-parse --short=12 HEAD 2>/dev/null || echo unknown)
mode=push
release=0
for arg in "$@"; do
  case "$arg" in
    --release) release=1 ;;
    --local) mode=local ;;
    *) echo "unknown option $arg" >&2; exit 64 ;;
  esac
done

if [ "$mode" = local ]; then
  docker build --build-arg VERSION="$version" --build-arg REVISION="$revision" \
    -t "$repository:dev" -t zorofin-companion:dev .
  echo "built $repository:dev (also tagged zorofin-companion:dev)"
  exit 0
fi

if [ -n "$(git status --porcelain -- . 2>/dev/null)" ]; then
  echo "the companion folder has uncommitted changes; commit them before publishing" >&2
  exit 65
fi

set -- -t "$repository:edge" -t "$repository:sha-$revision"
if [ "$release" = 1 ]; then
  set -- "$@" -t "$repository:$version" -t "$repository:latest"
fi

docker buildx inspect zorofin-multiarch >/dev/null 2>&1 || docker buildx create --name zorofin-multiarch >/dev/null
docker buildx build --builder zorofin-multiarch --platform "$platforms" \
  --build-arg VERSION="$version" --build-arg REVISION="$revision" \
  "$@" --push .
echo "pushed $repository ($platforms): edge, sha-$revision$( [ "$release" = 1 ] && echo ", $version, latest")"
