# Sourced by scripts/test-*.sh and scripts/migration-preview.sh: reserves the ports of a throwaway
# local stack and stops the stack, with its data, however the run ends (ADR 0014). The sourcing
# script sets $stack, the name its messages give the stack.

# A port is this run's once mkdir creates its directory, which is atomic between concurrent runs,
# and nothing on the host listens on it.
reservations="${TMPDIR:-/tmp}/knowno-test-db"
mkdir -p "$reservations"
reserved=()

# Sets the variable named $1 to the first port from $2 to $3 this run reserves; on failure,
# releases every port the run holds.
reserve() {
  local candidate
  for candidate in $(seq "$2" "$3"); do
    if mkdir "$reservations/$candidate" 2>/dev/null; then
      if (exec 3<>"/dev/tcp/127.0.0.1/$candidate") 2>/dev/null; then
        rmdir "$reservations/$candidate"
      else
        printf -v "$1" %s "$candidate"
        reserved+=("$candidate")
        return 0
      fi
    fi
  done
  echo "found no free port in $2-$3 for $stack; reservations are under $reservations" >&2
  release
  return 1
}

release() {
  local port
  # Bash 3.2, macOS's, counts an empty array as unset under set -u.
  for port in ${reserved[@]+"${reserved[@]}"}; do
    rmdir "$reservations/$port" 2>/dev/null || true
  done
}

# Stop prunes containers, volumes and networks, and Docker refuses a prune while another stack's
# stop is pruning, so a failed stop is retried. A stack left behind fails the run, whose exit
# status is $1 otherwise.
stop_stack() {
  local status=$1 attempt stopped
  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    if stopped=$(supabase stop --no-backup 2>&1); then
      release
      exit "$status"
    fi
    sleep 2
  done
  echo "$stopped" >&2
  echo "could not stop $stack $SUPABASE_PROJECT_ID after $attempt attempts; remove it with: supabase stop --no-backup --project-id $SUPABASE_PROJECT_ID" >&2
  release
  [ "$status" -ne 0 ] || status=1
  exit "$status"
}
