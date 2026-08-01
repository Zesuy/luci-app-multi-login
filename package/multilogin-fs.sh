#!/bin/sh
# Shared target-side file metadata helpers. Some OpenWrt BusyBox builds omit
# the stat applet, so every caller has a POSIX ls/awk fallback.

ml_fs_metadata_from_ls() {
	# Callers pass fixed absolute package paths, which cannot be ls options.
	# shellcheck disable=SC2012
	LC_ALL=C ls -ldn "$1" 2>/dev/null | awk '
		NR == 1 {
			mode = substr($1, 2, 9)
			if (length(mode) != 9 || $3 !~ /^[0-9]+$/ || $4 !~ /^[0-9]+$/) exit 1
			value = 0
			for (group = 0; group < 3; group++) {
				factor = group == 0 ? 64 : (group == 1 ? 8 : 1)
				r = substr(mode, group * 3 + 1, 1)
				w = substr(mode, group * 3 + 2, 1)
				x = substr(mode, group * 3 + 3, 1)
				if (r == "r") value += 4 * factor
				else if (r != "-") exit 1
				if (w == "w") value += 2 * factor
				else if (w != "-") exit 1
				if (x == "x" || x == "s" || x == "t") value += factor
				else if (x != "-" && x != "S" && x != "T") exit 1
				if (group == 0 && (x == "s" || x == "S")) value += 2048
				if (group == 1 && (x == "s" || x == "S")) value += 1024
				if (group == 2 && (x == "t" || x == "T")) value += 512
			}
			printf "%o %s %s\n", value, $3, $4
			found = 1
		}
		END { if (!found) exit 1 }
	'
}

ml_fs_metadata() {
	if command -v stat >/dev/null 2>&1; then
		ML_FS_VALUE=$(stat -c '%a %u %g' "$1" 2>/dev/null) && [ -n "$ML_FS_VALUE" ] && {
			printf '%s\n' "$ML_FS_VALUE"
			return 0
		}
	fi
	if command -v busybox >/dev/null 2>&1; then
		ML_FS_VALUE=$(busybox stat -c '%a %u %g' "$1" 2>/dev/null) && [ -n "$ML_FS_VALUE" ] && {
			printf '%s\n' "$ML_FS_VALUE"
			return 0
		}
	fi
	ml_fs_metadata_from_ls "$1"
}

ml_fs_mode() {
	ml_fs_metadata "$1" | awk 'NR == 1 { print $1; found = 1 } END { if (!found) exit 1 }'
}

ml_fs_size() {
	if command -v stat >/dev/null 2>&1; then
		ML_FS_VALUE=$(stat -c '%s' "$1" 2>/dev/null) && [ -n "$ML_FS_VALUE" ] && {
			printf '%s\n' "$ML_FS_VALUE"
			return 0
		}
	fi
	if command -v busybox >/dev/null 2>&1; then
		ML_FS_VALUE=$(busybox stat -c '%s' "$1" 2>/dev/null) && [ -n "$ML_FS_VALUE" ] && {
			printf '%s\n' "$ML_FS_VALUE"
			return 0
		}
	fi
	wc -c <"$1" 2>/dev/null | awk 'NR == 1 && $1 ~ /^[0-9]+$/ { print $1; found = 1 } END { if (!found) exit 1 }'
}
