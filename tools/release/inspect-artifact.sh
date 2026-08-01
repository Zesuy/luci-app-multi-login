#!/bin/sh

# Read-only OpenWrt IPK/APK inspection. It lists archive members and metadata
# only: no package installation, rootfs lifecycle, or service/network simulation.
set -eu

usage() {
	printf '%s\n' 'usage: inspect-artifact.sh (--ipk FILE --release-style plain|r | --apk FILE --apk-tool APK) --checksums FILE --tag vVERSION' >&2
	exit 2
}

fail() {
	printf 'artifact inspection: %s\n' "$1" >&2
	exit 1
}

IPK=
APK=
APK_TOOL=apk
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
	--apk)
		[ "$#" -ge 2 ] || usage
		APK=$2
		shift 2
		;;
	--apk-tool)
		[ "$#" -ge 2 ] || usage
		APK_TOOL=$2
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

if { [ -z "$IPK" ] && [ -z "$APK" ]; } || { [ -n "$IPK" ] && [ -n "$APK" ]; } || [ -z "$CHECKSUMS" ] || [ -z "$TAG" ]; then
	usage
fi
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
build_hook_core() {
	hook_source=$1
	printf 'ML_MIGRATION_EMBEDDED=1\n'
	cat "$REPOSITORY/package/multilogin-migrate.sh"
	cat "$hook_source"
}

verify_ipk_hook() {
	body=$1
	hook_source=$2
	build_hook_core "$hook_source" >"$TEMP_ROOT/hook-core"
	{
		printf '#!/bin/sh\n'
		cat "$TEMP_ROOT/hook-core"
	} >"$TEMP_ROOT/hook-expected"
	grep -F "\$(file <" "$body" >/dev/null && fail 'lifecycle script contains an unexpanded Makefile file expression'
	cmp -s "$TEMP_ROOT/hook-expected" "$body" || fail "IPK lifecycle hook does not exactly embed $(basename "$hook_source")"
}

verify_apk_hook() {
	adb=$1
	adb_hook=$2
	hook_source=$3
	strip_shebangs=$4
	# adbdump's block serializer omits blank records, while preserving every
	# other source line in order. apk-tools strips all embedded shebangs only
	# from the OpenWrt-generated post-install and pre-deinstall wrapper inputs.
	case $adb_hook in
	pre-install | post-deinstall)
		printf '#!/bin/sh\n' >"$TEMP_ROOT/hook-expected"
		;;
	post-install)
		cat >"$TEMP_ROOT/hook-expected" <<'EOF'
#!/bin/sh
[ "${IPKG_NO_SCRIPT}" = "1" ] && exit 0
[ -s ${IPKG_INSTROOT}/lib/functions.sh ] || exit 0
. ${IPKG_INSTROOT}/lib/functions.sh
export root="${IPKG_INSTROOT}"
export pkgname="luci-app-multilogin"
add_group_and_user
default_postinst
EOF
		;;
	pre-deinstall)
		cat >"$TEMP_ROOT/hook-expected" <<'EOF'
#!/bin/sh
[ -s ${IPKG_INSTROOT}/lib/functions.sh ] || exit 0
. ${IPKG_INSTROOT}/lib/functions.sh
export root="${IPKG_INSTROOT}"
export pkgname="luci-app-multilogin"
default_prerm
EOF
		;;
	*) fail "unsupported APK lifecycle hook: $adb_hook" ;;
	esac
	if [ "$strip_shebangs" = 1 ]; then
		build_hook_core "$hook_source" | sed '/^$/d; /^#!\/bin\/sh$/d' >>"$TEMP_ROOT/hook-expected"
	else
		build_hook_core "$hook_source" | sed '/^$/d' >>"$TEMP_ROOT/hook-expected"
	fi
	awk -v h="$adb_hook" '$0 == "  " h ": |" { count++ } END { exit count != 1 }' "$adb" ||
		fail "APK lifecycle hook $adb_hook is missing or duplicated"
	awk -v h="$adb_hook" '
		$0 == "  " h ": |" { on=1; next }
		on && /^  [a-z-]+: \|/ { exit }
		on { sub(/^    /, ""); print }
	' "$adb" >"$TEMP_ROOT/hook-adb-body"
	grep -F "\$(file <" "$TEMP_ROOT/hook-adb-body" >/dev/null && fail 'lifecycle script contains an unexpanded Makefile file expression'
	cmp -s "$TEMP_ROOT/hook-expected" "$TEMP_ROOT/hook-adb-body" || fail "APK lifecycle hook $adb_hook does not exactly match its generated wrapper and embedded $(basename "$hook_source")"
}
node "$SCRIPT_DIR/version-matrix.mjs" --tag "$TAG" >/dev/null
TEMP_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/multilogin-artifact.XXXXXX")
cleanup() { rm -rf "$TEMP_ROOT"; }
trap cleanup EXIT HUP INT TERM

if [ -n "$APK" ]; then
	[ "$RELEASE_STYLE" = r ] || fail 'APK inspection requires release-style r'
	if [ ! -f "$APK" ] || [ -L "$APK" ]; then
		fail "APK is not a regular file: $APK"
	fi
	command -v "$APK_TOOL" >/dev/null 2>&1 || fail "apk-tools v3 executable is unavailable: $APK_TOOL"
	PKG_APK_VERSION=$(sed -n 's/^PKG_APK_VERSION:=//p' "$REPOSITORY/Makefile")
	PKG_RELEASE=$(sed -n 's/^PKG_RELEASE:=//p' "$REPOSITORY/Makefile")
	EXPECTED_NAME="luci-app-multilogin-$PKG_APK_VERSION-r$PKG_RELEASE.apk"
	APK_NAME=$(basename -- "$APK")
	[ "$APK_NAME" = "$EXPECTED_NAME" ] || fail "expected archive name $EXPECTED_NAME, got $APK_NAME"
	EXPECTED_SHA=$(sha256sum "$APK" | awk '{print $1}')
	CHECKSUM_VALUE=$(awk -v name="$APK_NAME" '$2 == name || $2 == "*" name { if (++count != 1 || NF != 2) exit 1; print $1 } END { if (count != 1) exit 1 }' "$CHECKSUMS") || fail "checksum manifest has no unique entry for $APK_NAME"
	case $CHECKSUM_VALUE in '' | *[!0-9a-f]*) fail "checksum entry for $APK_NAME does not use lowercase SHA-256" ;; esac
	[ "${#CHECKSUM_VALUE}" -eq 64 ] || fail "checksum entry for $APK_NAME does not use lowercase SHA-256"
	[ "$CHECKSUM_VALUE" = "$EXPECTED_SHA" ] || fail "checksum mismatch for $APK_NAME"
	# apk-tools 3.0.5 supports adbdump, not `apk info --archive`. Both adbdump
	# and extract are archive reads; no package database or target root is used.
	"$APK_TOOL" adbdump "$APK" >"$TEMP_ROOT/apk.adb" || fail 'cannot read APK archive metadata'
	grep -Fx '  name: luci-app-multilogin' "$TEMP_ROOT/apk.adb" >/dev/null || fail 'APK package metadata mismatch'
	grep -Fx "  version: $PKG_APK_VERSION-r$PKG_RELEASE" "$TEMP_ROOT/apk.adb" >/dev/null || fail 'APK version metadata mismatch'
	grep -Fx '  arch: noarch' "$TEMP_ROOT/apk.adb" >/dev/null || fail 'APK architecture is not noarch'
	awk '/^  depends:/{on=1;next} on && /^  [A-Za-z]/{exit} on && /^    - /{sub(/^    - /, "");print}' "$TEMP_ROOT/apk.adb" | LC_ALL=C sort >"$TEMP_ROOT/apk-depends"
	printf '%s\n' bash curl jsonfilter libc luci-base mwan3 | LC_ALL=C sort >"$TEMP_ROOT/apk-depends.expected"
	cmp -s "$TEMP_ROOT/apk-depends.expected" "$TEMP_ROOT/apk-depends" || fail 'APK Depends does not exactly match package dependencies'
	mkdir "$TEMP_ROOT/apk-root" || fail 'cannot prepare APK inspection directory'
	"$APK_TOOL" extract --allow-untrusted --destination "$TEMP_ROOT/apk-root" --no-chown "$APK" >/dev/null || fail 'cannot inspect APK payload'
	: >"$TEMP_ROOT/apk-expected-files"
	for spec in \
		'0600 etc/config/multilogin' '0755 etc/init.d/multilogin' \
		'0755 etc/multilogin/login_control.bash' '0755 etc/multilogin/login.sh' '0755 etc/multilogin/check_status.sh' '0755 etc/multilogin/logout.sh' '0755 etc/multilogin/quick_setup.sh' \
		'0755 usr/lib/multilogin/cqu-portal.factory.sh' '0644 usr/lib/multilogin/script-policy.sh' '0644 usr/lib/multilogin/config-policy.sh' \
		'0755 usr/libexec/rpcd/multilogin' '0755 usr/libexec/multilogin-script' '0755 usr/libexec/multilogin-config' \
		'0644 usr/share/luci/menu.d/luci-app-multi-login.json' '0644 usr/share/rpcd/acl.d/luci-app-multi-login.json' \
		'0644 www/luci-static/resources/view/multilogin/overview.js' '0644 www/luci-static/resources/view/multilogin/configuration.js' '0644 www/luci-static/resources/view/multilogin/network.js' '0644 www/luci-static/resources/view/multilogin/script.js' '0644 www/luci-static/resources/view/multilogin/diagnostics.js' \
		'0644 lib/apk/packages/luci-app-multilogin.conffiles' '0644 lib/apk/packages/luci-app-multilogin.conffiles_static' '0644 lib/apk/packages/luci-app-multilogin.list'; do
		mode=${spec%% *}
		file=${spec#* }
		printf '%s\n' "$file" >>"$TEMP_ROOT/apk-expected-files"
		[ -f "$TEMP_ROOT/apk-root/$file" ] || fail "APK payload is missing: $file"
		actual_mode=$(stat -c %a "$TEMP_ROOT/apk-root/$file") || fail "cannot read APK payload mode: $file"
		expected_mode=${mode#0}
		[ "$actual_mode" = "$expected_mode" ] || fail "APK payload mode mismatch: $file (expected $mode, got $actual_mode)"
	done
	LC_ALL=C sort -u "$TEMP_ROOT/apk-expected-files" >"$TEMP_ROOT/apk-expected-files.sorted"
	find "$TEMP_ROOT/apk-root" -type f -printf '%P\n' | LC_ALL=C sort >"$TEMP_ROOT/apk-actual-files.sorted"
	cmp -s "$TEMP_ROOT/apk-expected-files.sorted" "$TEMP_ROOT/apk-actual-files.sorted" || fail 'APK regular-file manifest does not exactly match the package payload'
	verify_apk_hook "$TEMP_ROOT/apk.adb" pre-install "$REPOSITORY/package/hooks/preinst.sh" 0
	verify_apk_hook "$TEMP_ROOT/apk.adb" post-install "$REPOSITORY/package/hooks/postinst.sh" 1
	verify_apk_hook "$TEMP_ROOT/apk.adb" pre-deinstall "$REPOSITORY/package/hooks/prerm.sh" 1
	verify_apk_hook "$TEMP_ROOT/apk.adb" post-deinstall "$REPOSITORY/package/hooks/postrm.sh" 0
	grep -F "\$(file <" "$TEMP_ROOT/apk.adb" >/dev/null && fail 'APK lifecycle script contains an unexpanded Makefile file expression'
	printf 'artifact inspection passed: %s (%s)\n' "$APK_NAME" "$EXPECTED_SHA"
	exit 0
fi

[ -n "$RELEASE_STYLE" ] || usage
[ -f "$IPK" ] || fail "IPK is not a regular file: $IPK"

PKG_VERSION=$(sed -n 's/^PKG_SOURCE_VERSION:=//p' "$REPOSITORY/Makefile")
[ -n "$PKG_VERSION" ] || PKG_VERSION=$(sed -n 's/^PKG_VERSION:=//p' "$REPOSITORY/Makefile")
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

for mapping in 'preinst:preinst.sh' 'postinst-pkg:postinst.sh' 'prerm-pkg:prerm.sh' 'postrm:postrm.sh'; do
	control_name=${mapping%%:*}
	hook_name=${mapping#*:}
	tar -xOf "$TEMP_ROOT/control.tar" "./$control_name" >"$TEMP_ROOT/$control_name" 2>/dev/null ||
		tar -xOf "$TEMP_ROOT/control.tar" "$control_name" >"$TEMP_ROOT/$control_name" 2>/dev/null || fail "control archive is missing $control_name"
	verify_ipk_hook "$TEMP_ROOT/$control_name" "$REPOSITORY/package/hooks/$hook_name"
done

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
