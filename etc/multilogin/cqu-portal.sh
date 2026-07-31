#!/bin/sh

MULTILOGIN_SCRIPT_API=3
MULTILOGIN_SCRIPT_VERSION='3.0.0-rc.1'

PORTAL_BASE='https://login.cqu.edu.cn:802'
STATUS_JS_VERSION='4.X'
ACTION_JS_VERSION='4.2.2'
PORTAL_LANG='zh'
ZERO_MAC='000000000000'
PC_UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36'
MOBILE_UA='Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36'

ACTION='unknown'
INTERFACE=''
V6FACE=''
ACCOUNT=''
UA_TYPE=''
case ${MULTILOGIN_TEST_MODE:-0} in
1) TEST_MODE=1 ;;
*) TEST_MODE=0 ;;
esac
TEMP_BASE=''
TEMP_DIR=''
PASSWORD=''
WLAN_DEVICE=''
WLAN_IPV4=''
WLAN_IPV6=''
WLAN_MAC=''
WLAN_IPV4_B64=''
WLAN_IPV6_B64=''
PORTAL_RESPONSE=''
PORTAL_ERROR_KIND=''
REQUEST_CALLBACK=''
REQUEST_CACHE=''
STATUS_PHONE_FLAG=''
STATUS_ERROR_KIND=''
STATUS_POLLS=0

LC_ALL=C
export LC_ALL
umask 077

emit_json() {
	EMIT_OK=$1
	EMIT_ACTION=$2
	EMIT_OUTCOME=$3
	EMIT_ERROR_KIND=$4
	EMIT_DATA=$5

	if [ "$EMIT_ERROR_KIND" = null ]; then
		printf '{"ok":%s,"action":"%s","outcome":"%s","error_kind":null,"api":%s,"version":"%s","data":%s}\n' \
			"$EMIT_OK" "$EMIT_ACTION" "$EMIT_OUTCOME" "$MULTILOGIN_SCRIPT_API" "$MULTILOGIN_SCRIPT_VERSION" "$EMIT_DATA"
	else
		printf '{"ok":%s,"action":"%s","outcome":"%s","error_kind":"%s","api":%s,"version":"%s","data":%s}\n' \
			"$EMIT_OK" "$EMIT_ACTION" "$EMIT_OUTCOME" "$EMIT_ERROR_KIND" "$MULTILOGIN_SCRIPT_API" "$MULTILOGIN_SCRIPT_VERSION" "$EMIT_DATA"
	fi
}

diagnose() {
	DIAG_OUTCOME=$1
	printf 'multilogin portal: action=%s outcome=%s\n' "$ACTION" "$DIAG_OUTCOME" >&2

	if [ "$TEST_MODE" -eq 1 ]; then
		if command -v logger >/dev/null 2>&1; then
			logger -t multilogin-portal "action=$ACTION outcome=$DIAG_OUTCOME" >/dev/null 2>&1 || :
		fi
		return
	fi

	if [ -d /var/log ] && [ ! -L /var/log/multilogin.log ]; then
		if [ ! -e /var/log/multilogin.log ]; then
			(umask 077 && : >/var/log/multilogin.log) 2>/dev/null || :
		fi
		if [ -f /var/log/multilogin.log ] && [ ! -L /var/log/multilogin.log ]; then
			chmod 0600 /var/log/multilogin.log >/dev/null 2>&1 || :
			printf 'action=%s outcome=%s\n' "$ACTION" "$DIAG_OUTCOME" >>/var/log/multilogin.log 2>/dev/null || :
		fi
	fi
	if command -v logger >/dev/null 2>&1; then
		logger -t multilogin-portal "action=$ACTION outcome=$DIAG_OUTCOME" >/dev/null 2>&1 || :
	fi
}

# Trap entry points are intentionally reached indirectly by the shell.
# shellcheck disable=SC2317
cleanup() {
	PASSWORD=''
	PORTAL_RESPONSE=''
	if [ -n "$TEMP_DIR" ]; then
		case $TEMP_DIR in
		"$TEMP_BASE"/multilogin-portal.*)
			if [ "$TEMP_BASE" != / ] && [ -d "$TEMP_DIR" ] && [ ! -L "$TEMP_DIR" ]; then
				rm -rf "$TEMP_DIR" >/dev/null 2>&1 || :
			fi
			;;
		esac
	fi
	TEMP_DIR=''
}

fail_exit() {
	FAIL_STATUS=$1
	FAIL_OUTCOME=$2
	FAIL_KIND=$3
	FAIL_DATA=${4:-'{}'}
	PASSWORD=''
	diagnose "$FAIL_OUTCOME"
	emit_json false "$ACTION" "$FAIL_OUTCOME" "$FAIL_KIND" "$FAIL_DATA"
	exit "$FAIL_STATUS"
}

success_exit() {
	SUCCESS_STATUS=$1
	SUCCESS_OUTCOME=$2
	SUCCESS_DATA=${3:-'{}'}
	PASSWORD=''
	emit_json true "$ACTION" "$SUCCESS_OUTCOME" null "$SUCCESS_DATA"
	exit "$SUCCESS_STATUS"
}

# shellcheck disable=SC2317
on_signal() {
	trap - 0
	cleanup
	diagnose internal_error
	emit_json false "$ACTION" internal_error internal '{}'
	exit 3
}

trap cleanup 0
trap on_signal HUP INT TERM

command_exists() {
	command -v "$1" >/dev/null 2>&1
}

safe_identifier() {
	SAFE_VALUE=$1
	SAFE_MAX=$2
	[ -n "$SAFE_VALUE" ] || return 1
	[ "${#SAFE_VALUE}" -le "$SAFE_MAX" ] || return 1
	case $SAFE_VALUE in
	-*) return 1 ;;
	*[!A-Za-z0-9_.:@-]*) return 1 ;;
	esac
	return 0
}

safe_account() {
	SAFE_VALUE=$1
	[ -n "$SAFE_VALUE" ] || return 1
	case $SAFE_VALUE in
	*[[:cntrl:]]*) return 1 ;;
	esac
	# Account names are preserved UCI strings, not shell/UCI identifiers.
	# Quoting and curl-config escaping safely preserve spaces and UTF-8; only
	# control characters that cannot form a safe single argument are rejected.
	return 0
}

validate_ipv4() {
	VALIDATE_IPV4_VALUE=$1
	printf '%s\n' "$VALIDATE_IPV4_VALUE" | awk -F. '
		NF != 4 { exit 1 }
		{
			for (i = 1; i <= 4; i++) {
				if ($i !~ /^[0-9]+$/ || $i + 0 > 255)
					exit 1
			}
		}
	' >/dev/null 2>&1
}

validate_ipv6() {
	VALIDATE_IPV6_VALUE=$1
	[ -n "$VALIDATE_IPV6_VALUE" ] || return 1
	[ "${#VALIDATE_IPV6_VALUE}" -le 45 ] || return 1
	case $VALIDATE_IPV6_VALUE in
	*:*) ;;
	*) return 1 ;;
	esac
	case $VALIDATE_IPV6_VALUE in
	*[!0-9A-Fa-f:.]*) return 1 ;;
	esac
	return 0
}

normalize_mac() {
	printf '%s' "$1" | tr -d ':-' | tr '[:lower:]' '[:upper:]'
}

validate_mac() {
	VALIDATE_MAC_VALUE=$1
	[ "${#VALIDATE_MAC_VALUE}" -eq 12 ] || return 1
	case $VALIDATE_MAC_VALUE in
	*[!0-9A-F]*) return 1 ;;
	esac
	return 0
}

parse_arguments() {
	[ "$#" -gt 0 ] || return 1
	ACTION=$1
	shift

	case $ACTION in
	version | self-test)
		[ "$#" -eq 0 ] || return 1
		return 0
		;;
	status | login | logout) ;;
	*)
		ACTION='unknown'
		return 1
		;;
	esac

	SEEN_INTERFACE=0
	SEEN_V6FACE=0
	SEEN_ACCOUNT=0
	SEEN_UA=0
	while [ "$#" -gt 0 ]; do
		case $1 in
		--password)
			printf '%s\n' 'multilogin portal: --password is unsupported; pass one password line on standard input' >&2
			return 1
			;;
		--mwan3 | --v6face | --account | --ua-type)
			PARSE_OPTION=$1
			[ "$#" -ge 2 ] || return 1
			PARSE_VALUE=$2
			[ -n "$PARSE_VALUE" ] || return 1
			case $PARSE_OPTION in
			--mwan3)
				[ "$SEEN_INTERFACE" -eq 0 ] || return 1
				INTERFACE=$PARSE_VALUE
				SEEN_INTERFACE=1
				;;
			--v6face)
				[ "$SEEN_V6FACE" -eq 0 ] || return 1
				V6FACE=$PARSE_VALUE
				SEEN_V6FACE=1
				;;
			--account)
				[ "$SEEN_ACCOUNT" -eq 0 ] || return 1
				ACCOUNT=$PARSE_VALUE
				SEEN_ACCOUNT=1
				;;
			--ua-type)
				[ "$SEEN_UA" -eq 0 ] || return 1
				UA_TYPE=$PARSE_VALUE
				SEEN_UA=1
				;;
			esac
			shift 2
			;;
		*) return 1 ;;
		esac
	done

	[ "$SEEN_INTERFACE" -eq 1 ] || return 1
	safe_identifier "$INTERFACE" 64 || return 1
	if [ "$SEEN_V6FACE" -eq 1 ]; then
		safe_identifier "$V6FACE" 64 || return 1
	fi
	if [ "$SEEN_ACCOUNT" -eq 1 ]; then
		safe_account "$ACCOUNT" || return 1
	fi
	if [ "$SEEN_UA" -eq 1 ]; then
		case $UA_TYPE in
		pc | mobile) ;;
		*) return 1 ;;
		esac
	fi

	case $ACTION in
	login)
		[ "$SEEN_ACCOUNT" -eq 1 ] && [ "$SEEN_UA" -eq 1 ] || return 1
		;;
	logout)
		[ "$SEEN_ACCOUNT" -eq 1 ] || return 1
		;;
	esac
	return 0
}

validate_environment() {
	case ${MULTILOGIN_TEST_MODE:-0} in
	0 | '')
		TEST_MODE=0
		if [ -n "${MULTILOGIN_TEST_CALLBACK:-}" ] || [ -n "${MULTILOGIN_TEST_CACHE:-}" ]; then
			return 1
		fi
		PATH='/usr/sbin:/usr/bin:/sbin:/bin'
		export PATH
		;;
	1)
		TEST_MODE=1
		;;
	*) return 1 ;;
	esac

	if [ -n "${MULTILOGIN_TEST_BASE_URL:-}" ] || [ -n "${MULTILOGIN_TEST_HOST:-}" ] || [ -n "${MULTILOGIN_TEST_PORT:-}" ] || [ -n "${MULTILOGIN_TEST_ENDPOINT:-}" ]; then
		return 1
	fi
	if [ -n "${MULTILOGIN_TEST_CALLBACK:-}" ]; then
		case $MULTILOGIN_TEST_CALLBACK in
		*[!A-Za-z0-9_]*) return 1 ;;
		esac
		[ "${#MULTILOGIN_TEST_CALLBACK}" -le 64 ] || return 1
	fi
	if [ -n "${MULTILOGIN_TEST_CACHE:-}" ]; then
		case $MULTILOGIN_TEST_CACHE in
		*[!0-9]*) return 1 ;;
		esac
		[ "${#MULTILOGIN_TEST_CACHE}" -le 20 ] || return 1
	fi
	return 0
}

require_portal_dependencies() {
	for REQUIRED_COMMAND in mwan3 curl jsonfilter ifstatus ip mktemp chmod rm awk sed tr; do
		command_exists "$REQUIRED_COMMAND" || return 1
	done
	return 0
}

init_temp_dir() {
	TEMP_BASE=${TMPDIR:-/tmp}
	while [ "$TEMP_BASE" != / ] && [ "${TEMP_BASE%/}" != "$TEMP_BASE" ]; do
		TEMP_BASE=${TEMP_BASE%/}
	done
	case $TEMP_BASE in
	/*) ;;
	*) return 1 ;;
	esac
	[ "$TEMP_BASE" != / ] || return 1
	case $TEMP_BASE in
	*[!A-Za-z0-9_./-]*) return 1 ;;
	esac
	[ -d "$TEMP_BASE" ] && [ ! -L "$TEMP_BASE" ] || return 1
	TEMP_BASE=$(cd "$TEMP_BASE" 2>/dev/null && pwd -P) || return 1
	[ "$TEMP_BASE" != / ] || return 1
	case $TEMP_BASE in
	/*) ;;
	*) return 1 ;;
	esac
	case $TEMP_BASE in
	*[!A-Za-z0-9_./-]*) return 1 ;;
	esac

	TEMP_DIR=$(mktemp -d "$TEMP_BASE/multilogin-portal.XXXXXX" 2>/dev/null) || return 1
	case $TEMP_DIR in
	"$TEMP_BASE"/multilogin-portal.*) ;;
	*)
		TEMP_DIR=''
		return 1
		;;
	esac
	case $TEMP_DIR in
	*[!A-Za-z0-9_./-]*) return 1 ;;
	esac
	[ -d "$TEMP_DIR" ] && [ ! -L "$TEMP_DIR" ] || return 1
	chmod 0700 "$TEMP_DIR" 2>/dev/null || return 1
	return 0
}

secure_temp_file() {
	SECURE_PREFIX=$1
	SECURE_FILE=$(mktemp "$TEMP_DIR/$SECURE_PREFIX.XXXXXX" 2>/dev/null) || return 1
	case $SECURE_FILE in
	"$TEMP_DIR"/"$SECURE_PREFIX".*) ;;
	*) return 1 ;;
	esac
	case $SECURE_FILE in
	*[!A-Za-z0-9_./-]*) return 1 ;;
	esac
	[ -f "$SECURE_FILE" ] && [ ! -L "$SECURE_FILE" ] || return 1
	chmod 0600 "$SECURE_FILE" 2>/dev/null || return 1
	return 0
}

read_password() {
	PASSWORD=''
	PASSWORD_EXTRA=''
	for PASSWORD_COMMAND in dd od awk wc; do
		command_exists "$PASSWORD_COMMAND" || return 2
	done
	secure_temp_file credential || return 2
	PASSWORD_FILE=$SECURE_FILE
	dd bs=1025 count=2 of="$PASSWORD_FILE" 2>/dev/null || {
		rm -f "$PASSWORD_FILE" >/dev/null 2>&1 || :
		return 2
	}
	PASSWORD_SIZE=$(wc -c <"$PASSWORD_FILE" 2>/dev/null) || PASSWORD_SIZE=''
	case $PASSWORD_SIZE in
	'' | *[!0-9]*)
		rm -f "$PASSWORD_FILE" >/dev/null 2>&1 || :
		return 2
		;;
	esac
	if [ "$PASSWORD_SIZE" -gt 1025 ] || ! od -An -tu1 <"$PASSWORD_FILE" 2>/dev/null | awk '{ for (i=1; i<=NF; i++) if ($i == 0) exit 1 }'; then
		rm -f "$PASSWORD_FILE" >/dev/null 2>&1 || :
		return 1
	fi
	PASSWORD_READ_STATUS=0
	{
		IFS= read -r PASSWORD || PASSWORD_READ_STATUS=1
		if IFS= read -r PASSWORD_EXTRA || [ -n "$PASSWORD_EXTRA" ]; then
			PASSWORD_READ_STATUS=1
		fi
	} <"$PASSWORD_FILE"
	rm -f "$PASSWORD_FILE" >/dev/null 2>&1 || :
	[ "$PASSWORD_READ_STATUS" -eq 0 ] || {
		PASSWORD=''
		PASSWORD_EXTRA=''
		return 1
	}
	[ -n "$PASSWORD" ] || return 1
	[ "${#PASSWORD}" -le 1024 ] || return 1
	PASSWORD_EXTRA=''
	CR_CHAR=$(printf '\r')
	case $PASSWORD in
	*"$CR_CHAR"*)
		PASSWORD=''
		return 1
		;;
	esac
	return 0
}

base64_encode() {
	BASE64_INPUT=$1
	BASE64_OUTPUT=''
	if [ -z "$BASE64_INPUT" ]; then
		return 0
	fi
	if command_exists base64; then
		BASE64_OUTPUT=$(printf '%s' "$BASE64_INPUT" | base64 2>/dev/null) || return 1
	elif command_exists busybox && busybox base64 --help >/dev/null 2>&1; then
		BASE64_OUTPUT=$(printf '%s' "$BASE64_INPUT" | busybox base64 2>/dev/null) || return 1
	elif command_exists openssl; then
		BASE64_OUTPUT=$(printf '%s' "$BASE64_INPUT" | openssl base64 -A 2>/dev/null) || return 1
	else
		return 1
	fi
	BASE64_OUTPUT=$(printf '%s' "$BASE64_OUTPUT" | tr -d '\r\n')
	[ -n "$BASE64_OUTPUT" ] || return 1
	return 0
}

json_value() {
	JSON_VALUE_INPUT=$1
	JSON_VALUE_EXPR=$2
	printf '%s' "$JSON_VALUE_INPUT" | jsonfilter -e "$JSON_VALUE_EXPR" 2>/dev/null
}

resolve_named_device() {
	RESOLVE_INTERFACE=$1
	RESOLVED_DEVICE=''
	RESOLVE_IFSTATUS=$(ifstatus "$RESOLVE_INTERFACE" 2>/dev/null) || RESOLVE_IFSTATUS=''
	if [ -n "$RESOLVE_IFSTATUS" ]; then
		RESOLVED_DEVICE=$(json_value "$RESOLVE_IFSTATUS" '@["l3_device"]')
		[ -n "$RESOLVED_DEVICE" ] || RESOLVED_DEVICE=$(json_value "$RESOLVE_IFSTATUS" '@["device"]')
	fi
	if [ -z "$RESOLVED_DEVICE" ] && command_exists uci; then
		RESOLVED_DEVICE=$(uci -q get "network.$RESOLVE_INTERFACE.device" 2>/dev/null) || RESOLVED_DEVICE=''
		if [ -z "$RESOLVED_DEVICE" ]; then
			RESOLVED_DEVICE=$(uci -q get "network.$RESOLVE_INTERFACE.ifname" 2>/dev/null) || RESOLVED_DEVICE=''
		fi
	fi
	safe_identifier "$RESOLVED_DEVICE" 64 || return 1
	return 0
}

resolve_context() {
	resolve_named_device "$INTERFACE" || return 1
	WLAN_DEVICE=$RESOLVED_DEVICE

	IPV4_OUTPUT=$(ip -4 addr show dev "$WLAN_DEVICE" 2>/dev/null) || IPV4_OUTPUT=''
	WLAN_IPV4=$(printf '%s\n' "$IPV4_OUTPUT" | awk '{ for (i=1; i<=NF; i++) if ($i == "inet") { value=$(i+1); sub("/.*", "", value); print value; exit } }')
	validate_ipv4 "$WLAN_IPV4" || return 1

	MAC_OUTPUT=$(ip link show dev "$WLAN_DEVICE" 2>/dev/null) || MAC_OUTPUT=''
	MAC_VALUE=$(printf '%s\n' "$MAC_OUTPUT" | awk '{ for (i=1; i<=NF; i++) if ($i == "link/ether") { print $(i+1); exit } }')
	if [ -z "$MAC_VALUE" ] && [ -r "/sys/class/net/$WLAN_DEVICE/address" ]; then
		IFS= read -r MAC_VALUE <"/sys/class/net/$WLAN_DEVICE/address" || MAC_VALUE=''
	fi
	WLAN_MAC=$(normalize_mac "$MAC_VALUE")
	validate_mac "$WLAN_MAC" || return 1

	WLAN_IPV6=''
	if [ -n "$V6FACE" ]; then
		resolve_named_device "$V6FACE" || return 1
		IPV6_OUTPUT=$(ip -6 addr show dev "$RESOLVED_DEVICE" scope global 2>/dev/null) || IPV6_OUTPUT=''
		WLAN_IPV6=$(printf '%s\n' "$IPV6_OUTPUT" | awk '{ for (i=1; i<=NF; i++) if ($i == "inet6") { value=$(i+1); sub("/.*", "", value); if (value !~ /^fe80:/) { print value; exit } } }')
		validate_ipv6 "$WLAN_IPV6" || return 1
	fi

	base64_encode "$WLAN_IPV4" || return 2
	WLAN_IPV4_B64=$BASE64_OUTPUT
	base64_encode "$WLAN_IPV6" || return 2
	WLAN_IPV6_B64=$BASE64_OUTPUT
	return 0
}

config_escape() {
	CONFIG_ESCAPE_VALUE=$1
	CR_CHAR=$(printf '\r')
	case $CONFIG_ESCAPE_VALUE in
	*"$CR_CHAR"* | *'
'*) return 1 ;;
	esac
	printf '%s' "$CONFIG_ESCAPE_VALUE" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

write_config_value() {
	CONFIG_KEY=$1
	CONFIG_VALUE=$2
	CONFIG_ESCAPED=$(config_escape "$CONFIG_VALUE") || return 1
	printf '%s = "%s"\n' "$CONFIG_KEY" "$CONFIG_ESCAPED" >>"$CURL_CONFIG" || return 1
	return 0
}

prepare_request_tokens() {
	if [ "$TEST_MODE" -eq 1 ] && [ -n "${MULTILOGIN_TEST_CALLBACK:-}" ]; then
		REQUEST_CALLBACK=$MULTILOGIN_TEST_CALLBACK
	else
		REQUEST_CALLBACK=$(awk 'BEGIN { srand(); printf "ml%d", int(rand() * 900000) + 100000 }')
	fi
	if [ "$TEST_MODE" -eq 1 ] && [ -n "${MULTILOGIN_TEST_CACHE:-}" ]; then
		REQUEST_CACHE=$MULTILOGIN_TEST_CACHE
	else
		REQUEST_CACHE=$(awk 'BEGIN { srand(); printf "%d", int(rand() * 950000) + 50000 }')
	fi
}

portal_request() {
	PORTAL_URL=$1
	PORTAL_UA=$2
	shift 2
	PORTAL_RESPONSE=''
	PORTAL_ERROR_KIND=''

	secure_temp_file curl || {
		PORTAL_ERROR_KIND=internal
		return 1
	}
	CURL_CONFIG=$SECURE_FILE
	secure_temp_file response || {
		rm -f "$CURL_CONFIG" >/dev/null 2>&1 || :
		PORTAL_ERROR_KIND=internal
		return 1
	}
	CURL_RESPONSE=$SECURE_FILE

	: >"$CURL_CONFIG" || {
		PORTAL_ERROR_KIND=internal
		return 1
	}
	printf '%s\n' get silent show-error fail >>"$CURL_CONFIG" || {
		PORTAL_ERROR_KIND=internal
		return 1
	}
	printf '%s\n' 'connect-timeout = 8' 'max-time = 15' 'max-filesize = 131072' >>"$CURL_CONFIG" || {
		PORTAL_ERROR_KIND=internal
		return 1
	}
	write_config_value url "$PORTAL_URL" || {
		PORTAL_ERROR_KIND=encoding
		return 1
	}
	if [ -n "$PORTAL_UA" ]; then
		write_config_value user-agent "$PORTAL_UA" || {
			PORTAL_ERROR_KIND=encoding
			return 1
		}
	fi
	for PORTAL_PARAMETER; do
		write_config_value data-urlencode "$PORTAL_PARAMETER" || {
			PORTAL_ERROR_KIND=encoding
			return 1
		}
	done
	chmod 0600 "$CURL_CONFIG" "$CURL_RESPONSE" 2>/dev/null || {
		PORTAL_ERROR_KIND=internal
		return 1
	}

	if mwan3 use "$INTERFACE" curl --config "$CURL_CONFIG" >"$CURL_RESPONSE" 2>/dev/null; then
		PORTAL_CURL_STATUS=0
	else
		PORTAL_CURL_STATUS=$?
	fi
	rm -f "$CURL_CONFIG" >/dev/null 2>&1 || :
	CURL_CONFIG=''
	if [ "$PORTAL_CURL_STATUS" -ne 0 ]; then
		rm -f "$CURL_RESPONSE" >/dev/null 2>&1 || :
		PORTAL_ERROR_KIND=transport
		return 1
	fi
	PORTAL_SIZE=$(wc -c <"$CURL_RESPONSE" 2>/dev/null) || PORTAL_SIZE=''
	case $PORTAL_SIZE in
	'' | *[!0-9]*)
		PORTAL_ERROR_KIND=protocol
		return 1
		;;
	esac
	if [ "$PORTAL_SIZE" -eq 0 ] || [ "$PORTAL_SIZE" -gt 131072 ]; then
		rm -f "$CURL_RESPONSE" >/dev/null 2>&1 || :
		PORTAL_ERROR_KIND=protocol
		return 1
	fi
	PORTAL_RESPONSE=$(cat "$CURL_RESPONSE" 2>/dev/null) || {
		PORTAL_ERROR_KIND=protocol
		return 1
	}
	rm -f "$CURL_RESPONSE" >/dev/null 2>&1 || :
	return 0
}

strip_jsonp() {
	JSONP_PAYLOAD=$(printf '%s' "$1" | tr -d '\r\n')
	JSONP_CALLBACK=$2
	case $JSONP_PAYLOAD in
	"$JSONP_CALLBACK("*) ;;
	*) return 1 ;;
	esac
	JSONP_BODY=${JSONP_PAYLOAD#"$JSONP_CALLBACK("}
	case $JSONP_BODY in
	*');') JSONP_BODY=${JSONP_BODY%');'} ;;
	*')') JSONP_BODY=${JSONP_BODY%')'} ;;
	*) return 1 ;;
	esac
	[ -n "$JSONP_BODY" ] || return 1
	printf '%s' "$JSONP_BODY"
}

request_status_payload() {
	prepare_request_tokens
	portal_request "$PORTAL_BASE/eportal/portal/online_list" '' \
		"callback=$REQUEST_CALLBACK" \
		'user_account=' \
		'user_password=' \
		"wlan_user_mac=$WLAN_MAC" \
		"wlan_user_ip=$WLAN_IPV4_B64" \
		"wlan_user_ipv6=$WLAN_IPV6_B64" \
		"jsVersion=$STATUS_JS_VERSION" \
		"v=$REQUEST_CACHE" \
		"lang=$PORTAL_LANG"
}

record_field() {
	RECORD_FIELD_RECORD=$1
	shift
	RECORD_FIELD_VALUE=''
	for RECORD_FIELD_EXPR; do
		RECORD_FIELD_VALUE=$(json_value "$RECORD_FIELD_RECORD" "$RECORD_FIELD_EXPR")
		[ -z "$RECORD_FIELD_VALUE" ] || return 0
	done
	return 1
}

select_status_record() {
	SELECT_JSON=$1
	secure_temp_file records || return 1
	SELECT_RECORDS=$SECURE_FILE
	printf '%s' "$SELECT_JSON" | jsonfilter -e '@.list[*]' >"$SELECT_RECORDS" 2>/dev/null || return 1
	[ -s "$SELECT_RECORDS" ] || return 1
	secure_temp_file macselected || return 1
	SELECT_MAC_FILE=$SECURE_FILE
	secure_temp_file selected || return 1
	SELECT_FINAL_FILE=$SECURE_FILE

	SELECT_COUNT=0
	SELECT_MAC_SEEN=0
	while IFS= read -r SELECT_RECORD || [ -n "$SELECT_RECORD" ]; do
		[ -n "$SELECT_RECORD" ] || continue
		SELECT_COUNT=$((SELECT_COUNT + 1))
		[ "$SELECT_COUNT" -le 64 ] || return 1
		if record_field "$SELECT_RECORD" '@.wlan_user_mac' '@.user_mac' '@.mac'; then
			SELECT_MAC_SEEN=1
		fi
	done <"$SELECT_RECORDS"
	[ "$SELECT_COUNT" -gt 0 ] || return 1

	while IFS= read -r SELECT_RECORD || [ -n "$SELECT_RECORD" ]; do
		[ -n "$SELECT_RECORD" ] || continue
		if [ "$SELECT_MAC_SEEN" -eq 1 ]; then
			record_field "$SELECT_RECORD" '@.wlan_user_mac' '@.user_mac' '@.mac' || continue
			SELECT_RECORD_MAC=$(normalize_mac "$RECORD_FIELD_VALUE")
			[ "$SELECT_RECORD_MAC" = "$WLAN_MAC" ] || continue
		fi
		printf '%s\n' "$SELECT_RECORD" >>"$SELECT_MAC_FILE" || return 1
	done <"$SELECT_RECORDS"
	[ -s "$SELECT_MAC_FILE" ] || return 1

	SELECT_IP_SEEN=0
	while IFS= read -r SELECT_RECORD || [ -n "$SELECT_RECORD" ]; do
		[ -n "$SELECT_RECORD" ] || continue
		if record_field "$SELECT_RECORD" '@.wlan_user_ip' '@.user_ip' '@.ip'; then
			SELECT_IP_SEEN=1
		fi
	done <"$SELECT_MAC_FILE"

	SELECT_FINAL_COUNT=0
	while IFS= read -r SELECT_RECORD || [ -n "$SELECT_RECORD" ]; do
		[ -n "$SELECT_RECORD" ] || continue
		if [ "$SELECT_IP_SEEN" -eq 1 ]; then
			record_field "$SELECT_RECORD" '@.wlan_user_ip' '@.user_ip' '@.ip' || continue
			[ "$RECORD_FIELD_VALUE" = "$WLAN_IPV4" ] || continue
		fi
		printf '%s\n' "$SELECT_RECORD" >>"$SELECT_FINAL_FILE" || return 1
		SELECT_FINAL_COUNT=$((SELECT_FINAL_COUNT + 1))
	done <"$SELECT_MAC_FILE"
	[ "$SELECT_FINAL_COUNT" -eq 1 ] || return 1
	IFS= read -r SELECTED_STATUS_RECORD <"$SELECT_FINAL_FILE" || return 1
	record_field "$SELECTED_STATUS_RECORD" '@.phone_flag' || return 1
	case $RECORD_FIELD_VALUE in
	0 | 1) STATUS_PHONE_FLAG=$RECORD_FIELD_VALUE ;;
	*) return 1 ;;
	esac
	return 0
}

status_core() {
	STATUS_PHONE_FLAG=''
	STATUS_ERROR_KIND=''
	request_status_payload || {
		STATUS_ERROR_KIND=$PORTAL_ERROR_KIND
		return 3
	}
	STATUS_JSON=$(strip_jsonp "$PORTAL_RESPONSE" "$REQUEST_CALLBACK") || {
		STATUS_ERROR_KIND=protocol
		return 3
	}
	STATUS_RESULT=$(json_value "$STATUS_JSON" '@.result')
	case $STATUS_RESULT in
	0)
		return 1
		;;
	1)
		select_status_record "$STATUS_JSON" || {
			STATUS_ERROR_KIND=protocol
			return 3
		}
		return 0
		;;
	*)
		STATUS_ERROR_KIND=protocol
		return 3
		;;
	esac
}

ua_value() {
	case $UA_TYPE in
	pc) CURRENT_UA=$PC_UA ;;
	mobile) CURRENT_UA=$MOBILE_UA ;;
	*) CURRENT_UA='' ;;
	esac
}

expected_phone_flag() {
	case $UA_TYPE in
	pc) EXPECTED_PHONE_FLAG=0 ;;
	mobile) EXPECTED_PHONE_FLAG=1 ;;
	*) EXPECTED_PHONE_FLAG='' ;;
	esac
}

request_login() {
	ua_value
	case $UA_TYPE in
	pc)
		LOGIN_OPERATOR=0
		LOGIN_TERM_TYPE=1
		;;
	mobile)
		LOGIN_OPERATOR=1
		LOGIN_TERM_TYPE=2
		;;
	esac
	prepare_request_tokens
	portal_request "$PORTAL_BASE/eportal/portal/login" "$CURRENT_UA" \
		"callback=$REQUEST_CALLBACK" \
		'login_method=1' \
		"user_account=,$LOGIN_OPERATOR,$ACCOUNT" \
		"user_password=$PASSWORD" \
		"wlan_user_ip=$WLAN_IPV4" \
		"wlan_user_ipv6=$WLAN_IPV6" \
		"wlan_user_mac=$WLAN_MAC" \
		'wlan_ac_ip=' \
		'wlan_ac_name=' \
		"term_ua=$CURRENT_UA" \
		"term_type=$LOGIN_TERM_TYPE" \
		"jsVersion=$ACTION_JS_VERSION" \
		"terminal_type=$LOGIN_TERM_TYPE" \
		"v=$REQUEST_CACHE" \
		'lang=zh-cn' \
		"lang=$PORTAL_LANG"
}

parse_simple_result() {
	SIMPLE_JSON=$(strip_jsonp "$PORTAL_RESPONSE" "$REQUEST_CALLBACK") || return 1
	SIMPLE_RESULT=$(json_value "$SIMPLE_JSON" '@.result')
	SIMPLE_RET_CODE=$(json_value "$SIMPLE_JSON" '@.ret_code')
	case $SIMPLE_RESULT in
	0 | 1) return 0 ;;
	*) return 1 ;;
	esac
}

poll_login_status() {
	expected_phone_flag
	LOGIN_VALID_OFFLINE=0
	LOGIN_PROTOCOL_ERROR=0
	LOGIN_TRANSPORT_ERROR=0
	STATUS_POLLS=0
	while [ "$STATUS_POLLS" -lt 5 ]; do
		STATUS_POLLS=$((STATUS_POLLS + 1))
		if status_core; then
			if [ "$STATUS_PHONE_FLAG" = "$EXPECTED_PHONE_FLAG" ]; then
				return 0
			fi
			return 8
		else
			POLL_STATUS=$?
			case $POLL_STATUS in
			1) LOGIN_VALID_OFFLINE=1 ;;
			*)
				case $STATUS_ERROR_KIND in
				transport) LOGIN_TRANSPORT_ERROR=1 ;;
				*) LOGIN_PROTOCOL_ERROR=1 ;;
				esac
				;;
			esac
		fi
		if [ "$STATUS_POLLS" -lt 5 ]; then
			sleep 1 >/dev/null 2>&1 || :
		fi
	done
	if [ "$LOGIN_VALID_OFFLINE" -eq 1 ] || [ "$LOGIN_PROTOCOL_ERROR" -eq 1 ]; then
		STATUS_ERROR_KIND=protocol
	elif [ "$LOGIN_TRANSPORT_ERROR" -eq 1 ]; then
		STATUS_ERROR_KIND=transport
	else
		STATUS_ERROR_KIND=protocol
	fi
	return 3
}

request_unbind() {
	LOGOUT_IPV6=${WLAN_IPV6:-::}
	prepare_request_tokens
	portal_request "$PORTAL_BASE/eportal/portal/mac/unbind" '' \
		"callback=$REQUEST_CALLBACK" \
		"user_account=$ACCOUNT" \
		"wlan_user_mac=$ZERO_MAC" \
		"wlan_user_ip=$WLAN_IPV4" \
		"wlan_user_ipv6=$LOGOUT_IPV6" \
		"jsVersion=$ACTION_JS_VERSION" \
		"v=$REQUEST_CACHE" \
		"lang=$PORTAL_LANG"
}

request_check_logout() {
	LOGOUT_IPV6=${WLAN_IPV6:-::}
	prepare_request_tokens
	portal_request "$PORTAL_BASE/eportal/portal/custom/checkLogout" '' \
		"callback=$REQUEST_CALLBACK" \
		"wlan_user_ip=$WLAN_IPV4" \
		"wlan_user_ipv6=$LOGOUT_IPV6" \
		"jsVersion=$ACTION_JS_VERSION" \
		"v=$REQUEST_CACHE" \
		"lang=$PORTAL_LANG"
}

classify_stage_result() {
	STAGE_RESULT=protocol
	if [ -n "$PORTAL_ERROR_KIND" ]; then
		STAGE_RESULT=$PORTAL_ERROR_KIND
		return
	fi
	if ! parse_simple_result; then
		STAGE_RESULT=protocol
	elif [ "$SIMPLE_RESULT" = 1 ]; then
		STAGE_RESULT=success
	else
		STAGE_RESULT=negative
	fi
}

poll_logout_status() {
	LOGOUT_VALID_ONLINE=0
	LOGOUT_PROTOCOL_ERROR=0
	LOGOUT_TRANSPORT_ERROR=0
	STATUS_POLLS=0
	while [ "$STATUS_POLLS" -lt 10 ]; do
		STATUS_POLLS=$((STATUS_POLLS + 1))
		if status_core; then
			LOGOUT_VALID_ONLINE=1
		else
			POLL_STATUS=$?
			case $POLL_STATUS in
			1) return 0 ;;
			*)
				case $STATUS_ERROR_KIND in
				transport) LOGOUT_TRANSPORT_ERROR=1 ;;
				*) LOGOUT_PROTOCOL_ERROR=1 ;;
				esac
				;;
			esac
		fi
		if [ "$STATUS_POLLS" -lt 10 ]; then
			sleep 1 >/dev/null 2>&1 || :
		fi
	done
	if [ "$LOGOUT_VALID_ONLINE" -eq 1 ]; then
		return 9
	fi
	if [ "$LOGOUT_PROTOCOL_ERROR" -eq 1 ]; then
		STATUS_ERROR_KIND=protocol
	elif [ "$LOGOUT_TRANSPORT_ERROR" -eq 1 ]; then
		STATUS_ERROR_KIND=transport
	else
		STATUS_ERROR_KIND=protocol
	fi
	return 3
}

self_test() {
	SELF_TEST_JSON=$(strip_jsonp 'fixtureCallback({"result":1});' fixtureCallback) || return 1
	[ "$SELF_TEST_JSON" = '{"result":1}' ] || return 1
	base64_encode '192.0.2.1' || return 1
	[ "$BASE64_OUTPUT" = 'MTkyLjAuMi4x' ] || return 1
	SELF_TEST_ESCAPED=$(config_escape 'a"b\c') || return 1
	[ "$SELF_TEST_ESCAPED" = 'a\"b\\c' ] || return 1
	[ "$PORTAL_BASE" = 'https://login.cqu.edu.cn:802' ] || return 1
	return 0
}

run_status() {
	if status_core; then
		success_exit 0 online "{\"phone_flag\":$STATUS_PHONE_FLAG}"
	else
		RUN_STATUS=$?
		case $RUN_STATUS in
		1) success_exit 1 offline '{}' ;;
		*) fail_exit 3 "${STATUS_ERROR_KIND}_error" "$STATUS_ERROR_KIND" '{}' ;;
		esac
	fi
}

run_login() {
	expected_phone_flag
	if status_core; then
		if [ "$STATUS_PHONE_FLAG" = "$EXPECTED_PHONE_FLAG" ]; then
			success_exit 2 already_online "{\"phone_flag\":$STATUS_PHONE_FLAG,\"expected_ua_type\":\"$UA_TYPE\"}"
		fi
		fail_exit 8 classification_mismatch classification "{\"phone_flag\":$STATUS_PHONE_FLAG,\"expected_ua_type\":\"$UA_TYPE\"}"
	else
		LOGIN_PRECHECK_STATUS=$?
		if [ "$LOGIN_PRECHECK_STATUS" -ne 1 ]; then
			fail_exit 3 "${STATUS_ERROR_KIND}_error" "$STATUS_ERROR_KIND" '{}'
		fi
	fi

	if ! request_login; then
		case $PORTAL_ERROR_KIND in
		encoding) fail_exit 7 encoding_error encoding '{}' ;;
		internal) fail_exit 3 protocol_error internal '{}' ;;
		*) fail_exit 3 transport_error transport '{}' ;;
		esac
	fi
	if ! parse_simple_result; then
		fail_exit 3 protocol_error protocol '{}'
	fi
	LOGIN_RACE=0
	if [ "$SIMPLE_RET_CODE" = 2 ]; then
		LOGIN_RACE=1
	elif [ "$SIMPLE_RESULT" = 1 ]; then
		LOGIN_RACE=0
	else
		fail_exit 1 auth_rejected auth '{}'
	fi

	if poll_login_status; then
		if [ "$LOGIN_RACE" -eq 1 ]; then
			success_exit 2 already_online "{\"phone_flag\":$STATUS_PHONE_FLAG,\"expected_ua_type\":\"$UA_TYPE\",\"poll_count\":$STATUS_POLLS}"
		fi
		success_exit 0 login_success "{\"phone_flag\":$STATUS_PHONE_FLAG,\"expected_ua_type\":\"$UA_TYPE\",\"poll_count\":$STATUS_POLLS}"
	else
		LOGIN_POLL_STATUS=$?
		case $LOGIN_POLL_STATUS in
		8) fail_exit 8 classification_mismatch classification "{\"phone_flag\":$STATUS_PHONE_FLAG,\"expected_ua_type\":\"$UA_TYPE\",\"poll_count\":$STATUS_POLLS}" ;;
		*) fail_exit 3 "${STATUS_ERROR_KIND}_error" "$STATUS_ERROR_KIND" "{\"poll_count\":$STATUS_POLLS}" ;;
		esac
	fi
}

run_logout() {
	if status_core; then
		:
	else
		LOGOUT_PRECHECK_STATUS=$?
		case $LOGOUT_PRECHECK_STATUS in
		1) success_exit 0 already_offline '{}' ;;
		*) fail_exit 3 "${STATUS_ERROR_KIND}_error" "$STATUS_ERROR_KIND" '{}' ;;
		esac
	fi

	PORTAL_ERROR_KIND=''
	request_unbind || :
	classify_stage_result
	UNBIND_STAGE=$STAGE_RESULT
	PORTAL_ERROR_KIND=''
	request_check_logout || :
	classify_stage_result
	CHECK_LOGOUT_STAGE=$STAGE_RESULT

	if poll_logout_status; then
		success_exit 0 logout_success "{\"poll_count\":$STATUS_POLLS,\"unbind\":\"$UNBIND_STAGE\",\"check_logout\":\"$CHECK_LOGOUT_STAGE\"}"
	else
		LOGOUT_POLL_STATUS=$?
		case $LOGOUT_POLL_STATUS in
		9) fail_exit 9 logout_timeout timeout "{\"poll_count\":$STATUS_POLLS,\"unbind\":\"$UNBIND_STAGE\",\"check_logout\":\"$CHECK_LOGOUT_STAGE\"}" ;;
		*) fail_exit 3 "${STATUS_ERROR_KIND}_error" "$STATUS_ERROR_KIND" "{\"poll_count\":$STATUS_POLLS,\"unbind\":\"$UNBIND_STAGE\",\"check_logout\":\"$CHECK_LOGOUT_STAGE\"}" ;;
		esac
	fi
}

main() {
	if ! parse_arguments "$@"; then
		fail_exit 4 argument_error arguments '{}'
	fi
	if ! validate_environment; then
		fail_exit 4 argument_error arguments '{}'
	fi

	case $ACTION in
	version) success_exit 0 version '{}' ;;
	self-test)
		if self_test; then
			success_exit 0 self_test_pass '{}'
		fi
		fail_exit 5 dependency_error dependency '{}'
		;;
	esac

	if ! require_portal_dependencies; then
		fail_exit 5 dependency_error dependency '{}'
	fi
	if ! init_temp_dir; then
		fail_exit 5 dependency_error dependency '{}'
	fi
	if [ "$ACTION" = login ]; then
		read_password
		PASSWORD_STATUS=$?
		case $PASSWORD_STATUS in
		0) ;;
		1) fail_exit 4 argument_error arguments '{}' ;;
		*) fail_exit 5 dependency_error dependency '{}' ;;
		esac
	fi
	resolve_context
	RESOLVE_STATUS=$?
	case $RESOLVE_STATUS in
	0) ;;
	1) fail_exit 6 interface_error interface '{}' ;;
	*) fail_exit 7 encoding_error encoding '{}' ;;
	esac

	case $ACTION in
	status) run_status ;;
	login) run_login ;;
	logout) run_logout ;;
	esac
	fail_exit 3 internal_error internal '{}'
}

main "$@"
