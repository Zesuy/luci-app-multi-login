#!/bin/sh

# Read-only OpenWrt IPK inspection. It lists archive members and metadata only:
# no opkg invocation, rootfs extraction, or service/network simulation.
set -eu

usage() {
	printf '%s\n' 'usage: tools/release/inspect-artifact.sh --ipk FILE --checksums FILE --tag vVERSION --release-style plain|r' >&2
	exit 2
}

fail() {
	printf 'artifact inspection: %s\n' "$1" >&2
	exit 1
}

IPK=
CHECKSUMS=
TAG=
RELEASE_STYLE=
while [ "$#" -gt 0 ]; do
	case $1 in
	--ipk)
		[ "$#" -ge 2 ] || usage
		IPK=$2
		shift 2
		;;
	--checksums)
		[ "$#" -ge 2 ] || usage
		CHECKSUMS=$2
		shift 2
		;;
	--tag)
		[ "$#" -ge 2 ] || usage
		TAG=$2
		shift 2
		;;
	--release-style)
		[ "$#" -ge 2 ] || usage
		RELEASE_STYLE=$2
		shift 2
		;;
	*) usage ;;
	esac
done

if [ -z "$IPK" ] || [ -z "$CHECKSUMS" ] || [ -z "$TAG" ] || [ -z "$RELEASE_STYLE" ]; then
	usage
fi
[ -f "$IPK" ] || fail "IPK is not a regular file: $IPK"
[ -f "$CHECKSUMS" ] || fail "checksum manifest is not a regular file: $CHECKSUMS"

SCRIPT_DIR=$(
	CDPATH=''
	export CDPATH
	cd -- "$(dirname -- "$0")" && pwd
)
REPOSITORY=$(
	CDPATH=''
	export CDPATH
	cd -- "$SCRIPT_DIR/../.." && pwd
)
node "$SCRIPT_DIR/version-matrix.mjs" --tag "$TAG" >/dev/null

PKG_VERSION=$(sed -n 's/^PKG_VERSION:=//p' "$REPOSITORY/Makefile")
PKG_RELEASE=$(sed -n 's/^PKG_RELEASE:=//p' "$REPOSITORY/Makefile")
case $RELEASE_STYLE in
plain) EXPECTED_VERSION=$PKG_VERSION-$PKG_RELEASE ;;
r) EXPECTED_VERSION=$PKG_VERSION-r$PKG_RELEASE ;;
*) fail "unsupported package release style: $RELEASE_STYLE" ;;
esac
EXPECTED_NAME=luci-app-multilogin_${EXPECTED_VERSION}_all.ipk
IPK_NAME=$(basename -- "$IPK")
[ "$IPK_NAME" = "$EXPECTED_NAME" ] || fail "expected archive name $EXPECTED_NAME, got $IPK_NAME"

EXPECTED_SHA=$(sha256sum "$IPK" | awk '{print $1}')
CHECKSUM_VALUE=$(awk -v name="$IPK_NAME" '
	$2 == name || $2 == "*" name {
		if (++count != 1 || NF != 2) exit 1
		print $1
	}
	END { if (count != 1) exit 1 }
' "$CHECKSUMS") || fail "checksum manifest has no unique, well-formed entry for $IPK_NAME"
case $CHECKSUM_VALUE in
'' | *[!0-9a-f]*) fail "checksum entry for $IPK_NAME does not use lowercase SHA-256" ;;
esac
[ "${#CHECKSUM_VALUE}" -eq 64 ] || fail "checksum entry for $IPK_NAME does not use lowercase SHA-256"
[ "$CHECKSUM_VALUE" = "$EXPECTED_SHA" ] || fail "checksum mismatch for $IPK_NAME"

TEMP_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/multilogin-artifact.XXXXXX")
cleanup() { rm -rf "$TEMP_ROOT"; }
trap cleanup EXIT HUP INT TERM

if ar t "$IPK" >"$TEMP_ROOT/members" 2>/dev/null; then
	OUTER_FORMAT='ar'
elif tar -tf "$IPK" >"$TEMP_ROOT/members" 2>/dev/null; then
	OUTER_FORMAT='tar'
else
	fail 'unable to read IPK as an ar or tar archive'
fi
awk '/(^|\/)debian-binary$/ { found=1 } END { exit !found }' "$TEMP_ROOT/members" ||
	fail 'IPK is missing debian-binary'
CONTROL_MEMBER=$(awk '/(^|\/)control\.tar(\.[A-Za-z0-9]+)?$/ { print; exit }' "$TEMP_ROOT/members")
DATA_MEMBER=$(awk '/(^|\/)data\.tar(\.[A-Za-z0-9]+)?$/ { print; exit }' "$TEMP_ROOT/members")
[ -n "$CONTROL_MEMBER" ] || fail 'IPK is missing control archive'
[ -n "$DATA_MEMBER" ] || fail 'IPK is missing data archive'
if [ "$OUTER_FORMAT" = ar ]; then
	ar p "$IPK" "$CONTROL_MEMBER" >"$TEMP_ROOT/control.tar" || fail 'cannot read control archive'
	ar p "$IPK" "$DATA_MEMBER" >"$TEMP_ROOT/data.tar" || fail 'cannot read data archive'
else
	tar -xOf "$IPK" "$CONTROL_MEMBER" >"$TEMP_ROOT/control.tar" || fail 'cannot read control archive'
	tar -xOf "$IPK" "$DATA_MEMBER" >"$TEMP_ROOT/data.tar" || fail 'cannot read data archive'
fi

tar -xOf "$TEMP_ROOT/control.tar" ./control >"$TEMP_ROOT/control" 2>/dev/null ||
	tar -xOf "$TEMP_ROOT/control.tar" control >"$TEMP_ROOT/control" 2>/dev/null ||
	fail 'control archive is missing control metadata'

control_field() {
	awk -F ': ' -v key="$1" '$1 == key { print substr($0, length(key) + 3); found=1; exit } END { if (!found) exit 1 }' "$TEMP_ROOT/control"
}

[ "$(control_field Package)" = 'luci-app-multilogin' ] || fail 'control Package is not luci-app-multilogin'
[ "$(control_field Version)" = "$EXPECTED_VERSION" ] || fail "control Version is not $EXPECTED_VERSION"
[ "$(control_field Architecture)" = 'all' ] || fail 'control Architecture is not all'
DEPENDS=$(control_field Depends) || fail 'control metadata has no Depends field'
printf '%s\n' "$DEPENDS" | tr ',' '\n' | sed 's/^ *//;s/ *$//' | LC_ALL=C sort >"$TEMP_ROOT/actual-depends"
for DEPENDENCY in bash curl jsonfilter libc luci-base mwan3; do
	printf '%s\n' "$DEPENDENCY"
done | LC_ALL=C sort >"$TEMP_ROOT/expected-depends"
cmp -s "$TEMP_ROOT/expected-depends" "$TEMP_ROOT/actual-depends" ||
	fail 'control Depends does not exactly match bash, curl, jsonfilter, libc, luci-base, mwan3'

tar -tf "$TEMP_ROOT/data.tar" >"$TEMP_ROOT/data-list" || fail 'unable to list data archive'
tar -tvf "$TEMP_ROOT/data.tar" >"$TEMP_ROOT/data-verbose" || fail 'unable to inspect data archive modes'

require_payload() {
	PAYLOAD_MODE=$1
	PAYLOAD_PATH=./$2
	printf '%s\n' "$PAYLOAD_PATH" >>"$TEMP_ROOT/expected-data-list"
	PAYLOAD_PARENT=${PAYLOAD_PATH%/*}
	while [ "$PAYLOAD_PARENT" != '.' ]; do
		printf '%s/\n' "$PAYLOAD_PARENT" >>"$TEMP_ROOT/expected-data-list"
		PAYLOAD_PARENT=${PAYLOAD_PARENT%/*}
	done
	grep -Fx "$PAYLOAD_PATH" "$TEMP_ROOT/data-list" >/dev/null || fail "data archive is missing $PAYLOAD_PATH"
	case $PAYLOAD_MODE in
	0600) PAYLOAD_PERMS='-rw-------' ;;
	0644) PAYLOAD_PERMS='-rw-r--r--' ;;
	0755) PAYLOAD_PERMS='-rwxr-xr-x' ;;
	*) fail "unsupported expected mode $PAYLOAD_MODE" ;;
	esac
	awk -v path="$PAYLOAD_PATH" -v perms="$PAYLOAD_PERMS" '$1 == perms && $NF == path { found=1 } END { exit !found }' "$TEMP_ROOT/data-verbose" ||
		fail "data archive mode for $PAYLOAD_PATH is not $PAYLOAD_MODE"
}

require_payload 0600 etc/config/multilogin
require_payload 0755 etc/init.d/multilogin
require_payload 0755 etc/multilogin/login_control.bash
require_payload 0755 etc/multilogin/login.sh
require_payload 0755 etc/multilogin/check_status.sh
require_payload 0755 etc/multilogin/logout.sh
require_payload 0755 etc/multilogin/quick_setup.sh
require_payload 0755 usr/lib/multilogin/cqu-portal.factory.sh
require_payload 0644 usr/lib/multilogin/script-policy.sh
require_payload 0644 usr/lib/multilogin/config-policy.sh
require_payload 0755 usr/libexec/rpcd/multilogin
require_payload 0755 usr/libexec/multilogin-script
require_payload 0755 usr/libexec/multilogin-config
require_payload 0644 usr/share/luci/menu.d/luci-app-multi-login.json
require_payload 0644 usr/share/rpcd/acl.d/luci-app-multi-login.json
require_payload 0644 www/luci-static/resources/view/multilogin/overview.js
require_payload 0644 www/luci-static/resources/view/multilogin/configuration.js
require_payload 0644 www/luci-static/resources/view/multilogin/network.js
require_payload 0644 www/luci-static/resources/view/multilogin/script.js
require_payload 0644 www/luci-static/resources/view/multilogin/diagnostics.js

printf '%s\n' './' >>"$TEMP_ROOT/expected-data-list"
LC_ALL=C sort -u "$TEMP_ROOT/expected-data-list" >"$TEMP_ROOT/expected-data-list.sorted"
LC_ALL=C sort "$TEMP_ROOT/data-list" >"$TEMP_ROOT/data-list.sorted"
cmp -s "$TEMP_ROOT/expected-data-list.sorted" "$TEMP_ROOT/data-list.sorted" ||
	fail 'data archive file and directory list does not exactly match the package manifest'

for FORBIDDEN in ./etc/multilogin/cqu-portal.sh ./etc/multilogin/login_huxi.sh ./etc/multilogin/login_A.sh; do
	if grep -Fx "$FORBIDDEN" "$TEMP_ROOT/data-list" >/dev/null; then
		fail "package must not ship runtime/retired script $FORBIDDEN"
	fi
done

printf 'artifact inspection passed: %s (%s)\n' "$IPK_NAME" "$EXPECTED_SHA"
