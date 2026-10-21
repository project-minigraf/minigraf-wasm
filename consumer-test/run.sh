#!/usr/bin/env bash
# Consumer test: installs one of the two packages into an empty project, as a
# user does, and runs its README quick start and the consumer contract.
#
#   run.sh <browser|wasi> local <dist-dir> <version>   from the built tarball
#                                                      (dist-browser / dist-wasi)
#   run.sh <browser|wasi> registry <version>           `npm install @minigraf/<pkg>@<version>`
#
# browser: the pages run in headless Chromium (Playwright). Set
# PLAYWRIGHT_DEPS=1 to also install Chromium's system libraries (CI).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLAYWRIGHT_VERSION=1.55.0

usage() {
  echo "usage: $0 <browser|wasi> local <dist-dir> <version> | <browser|wasi> registry <version>" >&2
  exit 2
}

PKG="${1:-}"
case "$PKG" in browser|wasi) ;; *) usage ;; esac
shift

# wait_for <seconds> <command...>: run the command every 30 s until it succeeds.
wait_for() {
  local limit="$1"; shift
  local start=$SECONDS
  until "$@"; do
    if (( SECONDS - start >= limit )); then
      echo "::error::gave up after ${limit}s waiting for: $*"
      return 1
    fi
    sleep 30
  done
}

# Resolve the dist directory before leaving the caller's directory.
if [ "${1:-}" = local ]; then DIST="$(cd "$2" && pwd)"; fi

APP="$(mktemp -d)"
trap 'rm -rf "$APP"' EXIT
cd "$APP"
npm init -y > /dev/null

case "${1:-}" in
  local)
    VERSION="$3"
    npm install --no-audit --no-fund "$DIST/minigraf-$PKG-$VERSION.tgz"
    ;;
  registry)
    VERSION="$2"
    published() {
      [ "$(npm view "@minigraf/$PKG@$VERSION" version 2>/dev/null)" = "$VERSION" ]
    }
    wait_for 600 published
    npm install --no-audit --no-fund "@minigraf/$PKG@$VERSION"
    ;;
  *) usage ;;
esac

# Both packages ship their license files.
for f in LICENSE-MIT LICENSE-APACHE; do
  [ -f "node_modules/@minigraf/$PKG/$f" ] || { echo "::error::@minigraf/$PKG has no $f"; exit 1; }
done

case "$PKG" in
  wasi)
    cp "$HERE/wasi/repl.mjs" "$HERE/wasi/contract.mjs" .
    # The README's shell line, run as written.
    out=$(printf '%s\n' '(transact [[:alice :name "Alice"]])' '(query [:find ?n :where [?e :name ?n]])' | node repl.mjs)
    echo "$out"
    grep -q 'Alice' <<<"$out" || { echo "::error::the README quick start did not print Alice"; exit 1; }
    echo "ok: README quick start"
    node contract.mjs "$VERSION"
    ;;
  browser)
    cp "$HERE"/browser/*.html "$HERE"/browser/*.js "$HERE/browser/driver.mjs" .
    npm install --no-audit --no-fund --no-save "playwright@$PLAYWRIGHT_VERSION"
    if [ "${PLAYWRIGHT_DEPS:-}" = 1 ]; then
      npx playwright install --with-deps chromium
    else
      npx playwright install chromium
    fi
    node driver.mjs "$VERSION"
    ;;
esac
