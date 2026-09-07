#!/bin/bash

set -u

APP_NAME="K-VERSATION"
APP_URL="http://localhost:3000"
SCRIPT_DIR="$(cd -- "$(dirname "$0")" && pwd)"
SERVER_PID=""

pause_before_exit() {
  if [[ -t 0 ]]; then
    printf "\nPress Return to close this window..."
    read -r _
  fi
}

fail() {
  printf "\n%s could not start.\n%s\n" "$APP_NAME" "$1" >&2
  pause_before_exit
  exit 1
}

cleanup() {
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}

find_homebrew() {
  if command -v brew >/dev/null 2>&1; then
    command -v brew
    return
  fi

  for candidate in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    if [[ -x "$candidate" ]]; then
      printf "%s\n" "$candidate"
      return
    fi
  done

  return 1
}

install_formula() {
  local formula="$1"
  local description="$2"

  printf "\nInstalling %s (one-time setup)...\n" "$description"
  "$BREW" install "$formula" || fail "Homebrew could not install $description."
  eval "$("$BREW" shellenv)"
}

trap cleanup EXIT INT TERM

[[ "$(uname -s)" == "Darwin" ]] ||
  fail "This launcher is for macOS. On another system, run npm run dev."

cd "$SCRIPT_DIR" || fail "The application folder could not be opened."

printf "Starting %s from:\n%s\n" "$APP_NAME" "$SCRIPT_DIR"

BREW="$(find_homebrew || true)"
if [[ -n "$BREW" ]]; then
  eval "$("$BREW" shellenv)"
fi

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  if [[ -z "$BREW" ]]; then
    open "https://brew.sh"
    fail "Node.js is missing. Homebrew's setup page has been opened; install Homebrew, then double-click this launcher again."
  fi
  install_formula "node" "Node.js"
fi

node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 20 || (major === 20 && minor >= 9) ? 0 : 1)' ||
  fail "Node.js 20.9 or newer is required. Update Node.js, then try again."

if ! command -v ffmpeg >/dev/null 2>&1 ||
  ! command -v ffprobe >/dev/null 2>&1; then
  if [[ -z "$BREW" ]]; then
    open "https://brew.sh"
    fail "FFmpeg is missing. Homebrew's setup page has been opened; install Homebrew, then double-click this launcher again."
  fi
  install_formula "ffmpeg" "FFmpeg"
fi

if [[ ! -f ".env.local" ]]; then
  cp ".env.example" ".env.local" ||
    fail "The local settings file could not be created."
fi

printf "\nChecking application files...\n"
npm install --no-audit --no-fund ||
  fail "Application dependencies could not be installed. Check your internet connection and try again."

if curl --silent --fail "$APP_URL" 2>/dev/null |
  grep -q "K-VERSATION"; then
  printf "\n%s is already running. Opening it now...\n" "$APP_NAME"
  open "$APP_URL"
  exit 0
fi

if lsof -nP -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then
  fail "Port 3000 is already being used by another application. Close it, then try again."
fi

printf "\nLaunching %s...\n" "$APP_NAME"
npm run dev -- --hostname 127.0.0.1 &
SERVER_PID=$!

for ((attempt = 1; attempt <= 60; attempt += 1)); do
  if curl --silent --fail "$APP_URL" 2>/dev/null |
    grep -q "K-VERSATION"; then
    printf "\n%s is ready. Opening your browser...\n" "$APP_NAME"
    open "$APP_URL"
    printf "Keep this window open while using the app.\n"
    printf "Press Control-C here when you are finished.\n\n"
    wait "$SERVER_PID"
    exit $?
  fi

  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    wait "$SERVER_PID" || true
    fail "The local server stopped before it was ready."
  fi

  sleep 1
done

fail "The local server did not become ready within 60 seconds."
