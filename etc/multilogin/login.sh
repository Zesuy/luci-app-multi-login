#!/bin/sh
# Package-managed compatibility wrapper.  Passwords are framed on stdin.

core=/etc/multilogin/cqu-portal.sh
validate_core() {
	if [ "${MULTILOGIN_WRAPPER_TEST_MODE:-0}" = 1 ]; then
		case ${MULTILOGIN_TEST_PORTAL_PATH:-} in /*) core=$MULTILOGIN_TEST_PORTAL_PATH ;; *) return 1 ;; esac
		[ -f "$core" ] && [ ! -L "$core" ] && [ -x "$core" ] || return 1
	fi
	[ -f "$core" ] && [ ! -L "$core" ] && [ -x "$core" ]
}

usage_error() {
	printf '%s\n' 'multilogin login: invalid arguments; pass the password on standard input (not --password)' >&2
	exit 4
}

mwan3=''
account=''
v6face=''
ua_type=mobile
check_only=0
seen_check=0
seen_mwan3=0
seen_account=0
seen_v6face=0
seen_ua=0

while [ "$#" -gt 0 ]; do
	case $1 in
	--mwan3)
		if [ "$#" -lt 2 ] || [ -z "$2" ] || [ "$seen_mwan3" != 0 ]; then usage_error; fi
		mwan3=$2
		seen_mwan3=1
		shift 2
		;;
	--account)
		if [ "$#" -lt 2 ] || [ -z "$2" ] || [ "$seen_account" != 0 ]; then usage_error; fi
		account=$2
		seen_account=1
		shift 2
		;;
	--v6face)
		if [ "$#" -lt 2 ] || [ -z "$2" ] || [ "$seen_v6face" != 0 ]; then usage_error; fi
		v6face=$2
		seen_v6face=1
		shift 2
		;;
	--ua-type)
		if [ "$#" -lt 2 ] || [ "$seen_ua" != 0 ]; then usage_error; fi
		case $2 in pc | mobile) ua_type=$2 ;; *) usage_error ;; esac
		seen_ua=1
		shift 2
		;;
	--check-only)
		[ "$seen_check" = 0 ] || usage_error
		check_only=1
		seen_check=1
		shift
		;;
	--password) usage_error ;;
	*) usage_error ;;
	esac
done

[ -n "$mwan3" ] || usage_error

if [ "$check_only" = 1 ]; then
	validate_core || {
		printf '%s\n' 'multilogin login: portal core is unavailable' >&2
		exit 5
	}
	set -- status --mwan3 "$mwan3" --ua-type "$ua_type"
	[ -n "$v6face" ] && set -- "$@" --v6face "$v6face"
	[ -n "$account" ] && set -- "$@" --account "$account"
	exec "$core" "$@" </dev/null
fi

[ -n "$account" ] || usage_error
validate_core || {
	printf '%s\n' 'multilogin login: portal core is unavailable' >&2
	exit 5
}
set -- login --mwan3 "$mwan3" --account "$account" --ua-type "$ua_type"
[ -n "$v6face" ] && set -- "$@" --v6face "$v6face"
exec "$core" "$@"
