#!/bin/sh
# K10a: the screen worker's display (Dockerfile.worker, target "screen"). Starts Xvfb, a screen in memory, waits for
# its socket (browser.ts canShowWindow() looks for it), then runs the command (the worker, or a check) with DISPLAY set.
# `docker run --init` (or compose's `init: true`) reaps Xvfb when the container stops.
set -e
DISPLAY_NUMBER="${DISPLAY_NUMBER:-99}"
export DISPLAY=":${DISPLAY_NUMBER}"
# A restarted container keeps /tmp: the last run's lock and socket would make this Xvfb quit at once while the old
# socket still looked like a screen (26 Nov: every Chrome then failed to start). Nothing else runs yet, so they are stale.
rm -f "/tmp/.X${DISPLAY_NUMBER}-lock" "/tmp/.X11-unix/X${DISPLAY_NUMBER}"
Xvfb "${DISPLAY}" -screen 0 "${SCREEN_SIZE:-1920x1080x24}" -nolisten tcp -ac >/tmp/xvfb.log 2>&1 &
XVFB_PID=$!
for _ in $(seq 1 50); do
  [ -S "/tmp/.X11-unix/X${DISPLAY_NUMBER}" ] && break
  sleep 0.1
done
sleep 0.3
# Running, not exited: an exited Xvfb stays a zombie ("Z") until reaped, so `kill -0` alone would pass it.
XVFB_STATE="$(ps -o stat= -p "${XVFB_PID}" 2>/dev/null | cut -c1)"
if [ ! -S "/tmp/.X11-unix/X${DISPLAY_NUMBER}" ] || [ -z "${XVFB_STATE}" ] || [ "${XVFB_STATE}" = "Z" ]; then
  echo "screen: Xvfb did not start" >&2
  cat /tmp/xvfb.log >&2
  exit 1
fi
echo "screen: Xvfb on ${DISPLAY} (${SCREEN_SIZE:-1920x1080x24})"
# Chrome keeps its own sandbox, which needs Linux namespaces; Docker's default seccomp profile blocks them, and Chrome
# then dies at start ("failed to move to new namespaces"). Say so plainly instead of every run failing later.
if ! unshare --user --map-root-user true 2>/dev/null; then
  echo "screen: Chrome's sandbox cannot start here: run the container with --security-opt seccomp=unconfined (docs/DEPLOY.md)" >&2
fi
exec "$@"
