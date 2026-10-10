#!/bin/sh
# Print a Compose override for extra capability directories; run from the checkout.
set -eu

directories=${1:-}
case "$directories" in *'
'*) echo 'ROBOZIUM_LOCAL_DIRS must be a semicolon-separated single line' >&2; exit 1 ;; esac

printf 'services:\n  api:\n'
seen=";$(CDPATH= cd -- local && pwd -P);"
container_directories=
index=0
while [ -n "$directories" ]; do
  case "$directories" in
    *';'*) directory=${directories%%;*}; directories=${directories#*;} ;;
    *) directory=$directories; directories= ;;
  esac
  directory=$(printf '%s' "$directory" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
  [ -n "$directory" ] || continue
  if [ ! -d "$directory" ]; then
    printf 'ROBOZIUM_LOCAL_DIRS directory does not exist: %s\n' "$directory" >&2
    exit 1
  fi
  source=$(CDPATH= cd -- "$directory" && pwd -P)
  case "$seen" in *";$source;"*) continue ;; esac
  seen="$seen$source;"
  target="/app/.runtime/capability-roots/$index"
  if [ "$index" -eq 0 ]; then printf '    volumes:\n'; fi
  # YAML quoting and Compose interpolation must preserve literal host paths.
  escaped_source=$(printf '%s' "$source" | sed -e "s/'/''/g" -e 's/\$/$$/g')
  printf "      - type: bind\n        source: '%s'\n        target: '%s'\n        read_only: true\n        bind:\n          create_host_path: false\n" "$escaped_source" "$target"
  container_directories="${container_directories:+$container_directories;}$target"
  index=$((index + 1))
done
printf "    environment:\n      ROBOZIUM_LOCAL_DIRS: '%s'\n" "$container_directories"
