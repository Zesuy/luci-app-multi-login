#!/bin/sh
# Package-managed status compatibility wrapper.

core=/etc/multilogin/cqu-portal.sh
validate_core() {
	if [ "${MULTILOGIN_WRAPPER_TEST_MODE:-0}" = 1 ]; then
		case ${MULTILOGIN_TEST_PORTAL_PATH:-} in /*) core=$MULTILOGIN_TEST_PORTAL_PATH ;; *) return 1 ;; esac
		[ -f "$core" ] && [ ! -L "$core" ] && [ -x "$core" ] || return 1
	fi
	[ -f "$core" ] && [ ! -L "$core" ] && [ -x "$core" ]
}
usage_error() {
	printf '%s\n' 'multilogin status: invalid arguments; --password is not supported' >&2
	exit 4
}
mwan3=''
account=''
v6face=''
ua_type=''
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
	--password) usage_error ;;
	*) usage_error ;;
	esac
done
[ -n "$mwan3" ] || usage_error
validate_core || {
	printf '%s\n' 'multilogin status: portal core is unavailable' >&2
	exit 5
}
set -- status --mwan3 "$mwan3"
[ -n "$account" ] && set -- "$@" --account "$account"
[ -n "$v6face" ] && set -- "$@" --v6face "$v6face"
[ -n "$ua_type" ] && set -- "$@" --ua-type "$ua_type"
exec "$core" "$@" </dev/null
