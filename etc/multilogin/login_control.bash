#!/bin/bash

# MultiLogin's package-managed scheduler. Portal protocol behavior belongs in
# cqu-portal.sh; this process only owns UCI loading and per-instance timing.

PORTAL_SCRIPT_PATH='/etc/multilogin/cqu-portal.sh'
LOG_PATH='/var/log/multilogin.log'

DEFAULT_RETRY_DELAY=4
DEFAULT_MAX_RETRY_DELAY=16384
DEFAULT_ALREADY_LOGGED_DELAY=16
DEFAULT_MAIN_LOOP_SLEEP=5
DEFAULT_LOG_LEVEL='info'
MAX_SAFE_DELAY=2147483647

INITIAL_RETRY_DELAY=$DEFAULT_RETRY_DELAY
MAX_RETRY_DELAY=$DEFAULT_MAX_RETRY_DELAY
ALREADY_LOGGED_DELAY=$DEFAULT_ALREADY_LOGGED_DELAY
MAIN_LOOP_SLEEP=$DEFAULT_MAIN_LOOP_SLEEP
LOG_LEVEL=$DEFAULT_LOG_LEVEL

TEST_MODE=0
TEST_MAX_LOOPS=0
TEST_NOW_ENABLED=0
TEST_NOW_VALUE=0
TEST_JITTER=''

RUNTIME_BASE=''
RUNTIME_DIR=''
RESULT_FILE=''
NORMALIZED_SETTING=''
CURRENT_EPOCH=0
JITTER_VALUE=0
LOGIN_STATUS=3
LOGIN_OUTCOME='internal_error'
LOGIN_ERROR_KIND='internal'

declare -a INSTANCE_INTERFACES=()
declare -a INSTANCE_USERNAMES=()
declare -a INSTANCE_PASSWORDS=()
declare -a INSTANCE_UA_TYPES=()
declare -a INSTANCE_V6FACES=()
declare -a INSTANCE_BASE_DELAYS=()
declare -a INSTANCE_SCHEDULED_DELAYS=()
declare -a INSTANCE_LAST_ATTEMPTS=()
declare -a INSTANCE_ATTEMPTED=()

level_to_num() {
	case $1 in
	debug) printf '%s\n' 7 ;;
	info) printf '%s\n' 6 ;;
	notice) printf '%s\n' 5 ;;
	warning | warn) printf '%s\n' 4 ;;
	error | err) printf '%s\n' 3 ;;
	*) printf '%s\n' 6 ;;
	esac
}

logger_severity() {
	case $1 in
	error) printf '%s\n' err ;;
	warn) printf '%s\n' warning ;;
	*) printf '%s\n' "$1" ;;
	esac
}

write_file_log() {
	local message=$1

	# Tests never write to the host log. The logger mock still captures the
	# redacted diagnostic for assertions.
	((TEST_MODE == 0)) || return 0
	[[ -d /var/log && ! -L /var/log ]] || return 0
	[[ ! -L $LOG_PATH ]] || return 0
	if [[ ! -e $LOG_PATH ]]; then
		(umask 077 && : >"$LOG_PATH") 2>/dev/null || return 0
	fi
	[[ -f $LOG_PATH && ! -L $LOG_PATH ]] || return 0
	chmod 0600 "$LOG_PATH" >/dev/null 2>&1 || return 0
	printf '%s\n' "$message" >>"$LOG_PATH" 2>/dev/null || :
}

log() {
	local level=$1
	local message timestamp severity
	shift
	message=$*

	if (($(level_to_num "$level") > $(level_to_num "$LOG_LEVEL"))); then
		return 0
	fi
	timestamp=$(date '+%Y-%m-%d %H:%M:%S' 2>/dev/null) || timestamp='unknown-time'
	write_file_log "[$timestamp] [$$] [$level] $message"
	if command -v logger >/dev/null 2>&1; then
		severity=$(logger_severity "$level")
		logger -t "multi_login[$$]" -p "user.$severity" "[$level] $message" >/dev/null 2>&1 || :
	fi
}

cleanup() {
	local index

	for index in "${!INSTANCE_PASSWORDS[@]}"; do
		INSTANCE_PASSWORDS[index]=''
	done
	if [[ -n $RUNTIME_DIR ]]; then
		case $RUNTIME_DIR in
		"$RUNTIME_BASE"/multilogin-controller.*)
			if [[ $RUNTIME_BASE != / && -d $RUNTIME_DIR && ! -L $RUNTIME_DIR ]]; then
				rm -rf -- "$RUNTIME_DIR" >/dev/null 2>&1 || :
			fi
			;;
		esac
	fi
	RUNTIME_DIR=''
}

on_signal() {
	trap - HUP INT TERM
	log notice 'Received termination signal, exiting.'
	cleanup
	exit 0
}

trap cleanup EXIT
trap on_signal HUP INT TERM

safe_identifier() {
	local value=$1
	local maximum=$2

	[[ -n $value && ${#value} -le $maximum ]] || return 1
	case $value in
	-* | *[!A-Za-z0-9_.:@-]*) return 1 ;;
	esac
	return 0
}

safe_username() {
	local value=$1

	# Usernames are preserved UCI data, not UCI/network identifiers. Quoted
	# argv safely carries spaces and non-ASCII text; only values that cannot be
	# represented as one diagnostic-safe argument are rejected here.
	[[ -n $value ]] || return 1
	[[ ! $value =~ [[:cntrl:]] ]]
}

normalize_positive_setting() {
	local value=$1
	local fallback=$2
	local parsed

	NORMALIZED_SETTING=$fallback
	[[ $value =~ ^[0-9]+$ && ${#value} -le 10 ]] || return 0
	parsed=$((10#$value))
	((parsed > 0 && parsed <= MAX_SAFE_DELAY)) || return 0
	NORMALIZED_SETTING=$parsed
}

normalize_log_level() {
	case $1 in
	debug | info | notice | warning | error) LOG_LEVEL=$1 ;;
	*) LOG_LEVEL=$DEFAULT_LOG_LEVEL ;;
	esac
}

configure_test_mode() {
	local value

	case ${MULTILOGIN_TEST_MODE:-0} in
	1) TEST_MODE=1 ;;
	*) TEST_MODE=0 ;;
	esac

	if ((TEST_MODE == 0)); then
		# Environment overrides are meaningful only behind the explicit test
		# switch. A production daemon always uses package paths and real time.
		PORTAL_SCRIPT_PATH='/etc/multilogin/cqu-portal.sh'
		return 0
	fi

	# Test mode is fail-closed: a missing or invalid override must never fall
	# back to the production portal path and accidentally perform a real call.
	PORTAL_SCRIPT_PATH=''
	value=${MULTILOGIN_TEST_PORTAL_PATH:-}
	if [[ $value == /* && -f $value && -x $value && ! -L $value ]]; then
		PORTAL_SCRIPT_PATH=$value
	fi

	value=${MULTILOGIN_TEST_MAX_LOOPS:-0}
	if [[ $value =~ ^[0-9]+$ && ${#value} -le 9 ]]; then
		TEST_MAX_LOOPS=$((10#$value))
	else
		TEST_MAX_LOOPS=1
	fi

	value=${MULTILOGIN_TEST_NOW:-}
	if [[ $value =~ ^[0-9]+$ && ${#value} -le 10 ]]; then
		TEST_NOW_ENABLED=1
		TEST_NOW_VALUE=$((10#$value))
	fi

	value=${MULTILOGIN_TEST_JITTER:-}
	if [[ $value =~ ^-?[0-9]+$ && ${#value} -le 11 ]]; then
		TEST_JITTER=$value
	elif [[ -n $value ]]; then
		TEST_JITTER=0
	fi
}

current_epoch() {
	local value

	if ((TEST_MODE == 1 && TEST_NOW_ENABLED == 1)); then
		CURRENT_EPOCH=$TEST_NOW_VALUE
		return 0
	fi
	value=$(date +%s 2>/dev/null) || value=''
	if [[ $value =~ ^[0-9]+$ && ${#value} -le 10 ]]; then
		CURRENT_EPOCH=$((10#$value))
	else
		CURRENT_EPOCH=0
	fi
}

controller_sleep() {
	local seconds=$1

	sleep "$seconds" >/dev/null 2>&1 || :
	if ((TEST_MODE == 1 && TEST_NOW_ENABLED == 1)); then
		TEST_NOW_VALUE=$((TEST_NOW_VALUE + seconds))
	fi
}

ensure_runtime_dir() {
	[[ -n $RUNTIME_DIR ]] && return 0
	if ((TEST_MODE == 1)); then
		RUNTIME_BASE=${TMPDIR:-/tmp}
	else
		RUNTIME_BASE=/tmp
	fi
	while [[ $RUNTIME_BASE != / && ${RUNTIME_BASE%/} != "$RUNTIME_BASE" ]]; do
		RUNTIME_BASE=${RUNTIME_BASE%/}
	done
	[[ $RUNTIME_BASE == /* && $RUNTIME_BASE != / ]] || return 1
	case $RUNTIME_BASE in
	*[!A-Za-z0-9_./-]*) return 1 ;;
	esac
	[[ -d $RUNTIME_BASE && ! -L $RUNTIME_BASE ]] || return 1
	RUNTIME_BASE=$(cd "$RUNTIME_BASE" 2>/dev/null && pwd -P) || return 1
	[[ $RUNTIME_BASE == /* && $RUNTIME_BASE != / ]] || return 1
	RUNTIME_DIR=$(mktemp -d "$RUNTIME_BASE/multilogin-controller.XXXXXX" 2>/dev/null) || {
		RUNTIME_DIR=''
		return 1
	}
	case $RUNTIME_DIR in
	"$RUNTIME_BASE"/multilogin-controller.*) ;;
	*)
		RUNTIME_DIR=''
		return 1
		;;
	esac
	[[ -d $RUNTIME_DIR && ! -L $RUNTIME_DIR ]] || return 1
	chmod 0700 "$RUNTIME_DIR" 2>/dev/null || return 1
}

secure_result_file() {
	ensure_runtime_dir || return 1
	RESULT_FILE=$(mktemp "$RUNTIME_DIR/result.XXXXXX" 2>/dev/null) || return 1
	case $RESULT_FILE in
	"$RUNTIME_DIR"/result.*) ;;
	*) return 1 ;;
	esac
	[[ -f $RESULT_FILE && ! -L $RESULT_FILE ]] || return 1
	chmod 0600 "$RESULT_FILE" 2>/dev/null || return 1
}

json_field() {
	local file=$1
	local expression=$2

	jsonfilter -e "$expression" <"$file" 2>/dev/null
}

validate_login_envelope() {
	local raw_status=$1
	local file=$2
	local size lines action outcome error_kind api version ok data

	LOGIN_STATUS=3
	LOGIN_OUTCOME='invalid_output'
	LOGIN_ERROR_KIND='protocol'
	command -v jsonfilter >/dev/null 2>&1 || return 1
	size=$(wc -c <"$file" 2>/dev/null) || size=''
	lines=$(wc -l <"$file" 2>/dev/null) || lines=''
	[[ $size =~ ^[0-9]+$ && $lines =~ ^[0-9]+$ ]] || return 1
	((size > 0 && size <= 4096 && lines == 1)) || return 1

	action=$(json_field "$file" '@["action"]') || return 1
	outcome=$(json_field "$file" '@["outcome"]') || return 1
	error_kind=$(json_field "$file" '@["error_kind"]') || return 1
	api=$(json_field "$file" '@["api"]') || return 1
	version=$(json_field "$file" '@["version"]') || return 1
	ok=$(json_field "$file" '@["ok"]') || return 1
	data=$(json_field "$file" '@["data"]') || return 1
	[[ $action == login && $api == 3 && $data == \{*\} ]] || return 1
	[[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$ ]] || return 1
	case $ok in
	1 | true) ok=1 ;;
	0 | false) ok=0 ;;
	*) return 1 ;;
	esac

	case $raw_status in
	0)
		[[ $ok == 1 && $outcome == login_success && -z $error_kind ]] || return 1
		;;
	1)
		[[ $ok == 0 && $outcome == auth_rejected && $error_kind == auth ]] || return 1
		;;
	2)
		[[ $ok == 1 && $outcome == already_online && -z $error_kind ]] || return 1
		;;
	3)
		[[ $ok == 0 ]] || return 1
		case "$outcome:$error_kind" in
		transport_error:transport | protocol_error:protocol | internal_error:internal) ;;
		*) return 1 ;;
		esac
		;;
	4) [[ $ok == 0 && $outcome == argument_error && $error_kind == arguments ]] || return 1 ;;
	5) [[ $ok == 0 && $outcome == dependency_error && $error_kind == dependency ]] || return 1 ;;
	6) [[ $ok == 0 && $outcome == interface_error && $error_kind == interface ]] || return 1 ;;
	7) [[ $ok == 0 && $outcome == encoding_error && $error_kind == encoding ]] || return 1 ;;
	8) [[ $ok == 0 && $outcome == classification_mismatch && $error_kind == classification ]] || return 1 ;;
	*) return 1 ;;
	esac

	LOGIN_STATUS=$raw_status
	LOGIN_OUTCOME=$outcome
	LOGIN_ERROR_KIND=${error_kind:-none}
	return 0
}

calculate_jitter() {
	local base=$1
	local range span random_value injected

	range=$((base / 10))
	if ((range == 0)); then
		JITTER_VALUE=0
		return 0
	fi
	if ((TEST_MODE == 1)) && [[ -n $TEST_JITTER ]]; then
		injected=$TEST_JITTER
		((injected < -range)) && injected=$((-range))
		((injected > range)) && injected=$range
		JITTER_VALUE=$injected
		return 0
	fi
	span=$((range * 2 + 1))
	random_value=$(((RANDOM << 30) ^ (RANDOM << 15) ^ RANDOM))
	JITTER_VALUE=$((random_value % span - range))
}

schedule_from_base() {
	local index=$1
	local base=${INSTANCE_BASE_DELAYS[$index]}
	local scheduled upper

	calculate_jitter "$base"
	scheduled=$((base + JITTER_VALUE))
	upper=$((MAX_RETRY_DELAY + MAX_RETRY_DELAY / 10))
	((scheduled < 1)) && scheduled=1
	((scheduled > upper)) && scheduled=$upper
	INSTANCE_SCHEDULED_DELAYS[index]=$scheduled
}

apply_login_result() {
	local index=$1
	local status=$2
	local current base

	case $status in
	0)
		INSTANCE_BASE_DELAYS[index]=$INITIAL_RETRY_DELAY
		schedule_from_base "$index"
		log notice "${INSTANCE_INTERFACES[$index]} login succeeded; next base=${INSTANCE_BASE_DELAYS[$index]}s scheduled=${INSTANCE_SCHEDULED_DELAYS[$index]}s."
		;;
	2)
		INSTANCE_BASE_DELAYS[index]=$ALREADY_LOGGED_DELAY
		schedule_from_base "$index"
		log info "${INSTANCE_INTERFACES[$index]} was already online; next base=${INSTANCE_BASE_DELAYS[$index]}s scheduled=${INSTANCE_SCHEDULED_DELAYS[$index]}s."
		;;
	*)
		current=${INSTANCE_BASE_DELAYS[$index]}
		base=$((current * 2))
		((base > MAX_RETRY_DELAY)) && base=$MAX_RETRY_DELAY
		INSTANCE_BASE_DELAYS[index]=$base
		schedule_from_base "$index"
		log warning "${INSTANCE_INTERFACES[$index]} login failed class=$LOGIN_ERROR_KIND outcome=$LOGIN_OUTCOME; next base=${INSTANCE_BASE_DELAYS[$index]}s scheduled=${INSTANCE_SCHEDULED_DELAYS[$index]}s."
		;;
	esac
}

login_interface() {
	local index=$1
	local output_file raw_status
	local -a portal_args

	LOGIN_STATUS=5
	LOGIN_OUTCOME='dependency_error'
	LOGIN_ERROR_KIND='dependency'
	if [[ ! -f $PORTAL_SCRIPT_PATH || ! -x $PORTAL_SCRIPT_PATH || -L $PORTAL_SCRIPT_PATH ]]; then
		log error "${INSTANCE_INTERFACES[$index]} portal script is unavailable."
		apply_login_result "$index" "$LOGIN_STATUS"
		return "$LOGIN_STATUS"
	fi
	secure_result_file || {
		LOGIN_STATUS=3
		LOGIN_OUTCOME='internal_error'
		LOGIN_ERROR_KIND='internal'
		log error "${INSTANCE_INTERFACES[$index]} could not create secure action state."
		apply_login_result "$index" "$LOGIN_STATUS"
		return "$LOGIN_STATUS"
	}
	output_file=$RESULT_FILE

	portal_args=(
		login
		--mwan3 "${INSTANCE_INTERFACES[$index]}"
		--account "${INSTANCE_USERNAMES[$index]}"
		--ua-type "${INSTANCE_UA_TYPES[$index]}"
	)
	if [[ -n ${INSTANCE_V6FACES[$index]} ]]; then
		portal_args+=(--v6face "${INSTANCE_V6FACES[$index]}")
	fi

	log info "${INSTANCE_INTERFACES[$index]} attempting managed portal login (UA=${INSTANCE_UA_TYPES[$index]})."
	printf '%s\n' "${INSTANCE_PASSWORDS[$index]}" |
		"$PORTAL_SCRIPT_PATH" "${portal_args[@]}" >"$output_file" 2>/dev/null
	raw_status=$?
	if ! validate_login_envelope "$raw_status" "$output_file"; then
		LOGIN_STATUS=3
		LOGIN_OUTCOME='invalid_output'
		LOGIN_ERROR_KIND='protocol'
	fi
	rm -f -- "$output_file" >/dev/null 2>&1 || :
	apply_login_result "$index" "$LOGIN_STATUS"
	return "$LOGIN_STATUS"
}

load_settings() {
	local value

	value=$(uci -q get multilogin.global.retry_interval 2>/dev/null) || value=''
	normalize_positive_setting "$value" "$DEFAULT_RETRY_DELAY"
	INITIAL_RETRY_DELAY=$NORMALIZED_SETTING

	value=$(uci -q get multilogin.global.check_interval 2>/dev/null) || value=''
	normalize_positive_setting "$value" "$DEFAULT_MAIN_LOOP_SLEEP"
	MAIN_LOOP_SLEEP=$NORMALIZED_SETTING

	value=$(uci -q get multilogin.global.max_retry_delay 2>/dev/null) || value=''
	normalize_positive_setting "$value" "$DEFAULT_MAX_RETRY_DELAY"
	MAX_RETRY_DELAY=$NORMALIZED_SETTING
	((MAX_RETRY_DELAY < INITIAL_RETRY_DELAY)) && MAX_RETRY_DELAY=$INITIAL_RETRY_DELAY

	value=$(uci -q get multilogin.global.already_logged_delay 2>/dev/null) || value=''
	normalize_positive_setting "$value" "$DEFAULT_ALREADY_LOGGED_DELAY"
	ALREADY_LOGGED_DELAY=$NORMALIZED_SETTING

	value=$(uci -q get multilogin.global.log_level 2>/dev/null) || value=''
	normalize_log_level "$value"
}

load_instances() {
	local section instance_enabled interface v6face ua_type account_ref username password
	local index=0

	while IFS= read -r section; do
		[[ -n $section ]] || continue
		safe_identifier "$section" 64 || continue
		instance_enabled=$(uci -q get "multilogin.$section.enabled" 2>/dev/null) || instance_enabled=''
		[[ $instance_enabled == 1 ]] || continue

		interface=$(uci -q get "multilogin.$section.interface" 2>/dev/null) || interface=''
		v6face=$(uci -q get "multilogin.$section.v6face" 2>/dev/null) || v6face=''
		ua_type=$(uci -q get "multilogin.$section.ua_type" 2>/dev/null) || ua_type=''
		case $ua_type in
		pc | mobile) ;;
		*) ua_type=pc ;;
		esac
		account_ref=$(uci -q get "multilogin.$section.account" 2>/dev/null) || account_ref=''
		username=''
		password=''
		if safe_identifier "$account_ref" 64; then
			username=$(uci -q get "multilogin.$account_ref.username" 2>/dev/null) || username=''
			password=$(uci -q get "multilogin.$account_ref.password" 2>/dev/null) || password=''
		fi

		if ! safe_identifier "$interface" 64 ||
			! safe_username "$username" ||
			[[ -z $password ]] ||
			{ [[ -n $v6face ]] && ! safe_identifier "$v6face" 64; }; then
			log warning "Instance configuration is incomplete or invalid; skipped."
			password=''
			continue
		fi

		INSTANCE_INTERFACES[index]=$interface
		INSTANCE_USERNAMES[index]=$username
		INSTANCE_PASSWORDS[index]=$password
		INSTANCE_UA_TYPES[index]=$ua_type
		INSTANCE_V6FACES[index]=$v6face
		INSTANCE_BASE_DELAYS[index]=$INITIAL_RETRY_DELAY
		INSTANCE_SCHEDULED_DELAYS[index]=$INITIAL_RETRY_DELAY
		INSTANCE_LAST_ATTEMPTS[index]=0
		INSTANCE_ATTEMPTED[index]=0
		password=''
		log info "Loaded instance #$index: Interface=$interface, IPv6_IF=${v6face:-none}, UA=$ua_type."
		index=$((index + 1))
	done < <(uci show multilogin 2>/dev/null | awk -F'[.=]' '$3 == "instance" {print $2}' | LC_ALL=C sort -u)
}

interface_line_for() {
	local status_output=$1
	local interface=$2

	awk -v interface="$interface" '$1 == "interface" && $2 == interface {print; exit}' <<<"$status_output"
}

run_loop() {
	local loop_count=0
	local status_output current_time index interface line status elapsed

	while :; do
		loop_count=$((loop_count + 1))
		if ((${#INSTANCE_INTERFACES[@]} == 0)); then
			controller_sleep "$MAIN_LOOP_SLEEP"
			if ((TEST_MODE == 1 && TEST_MAX_LOOPS > 0 && loop_count >= TEST_MAX_LOOPS)); then
				return 0
			fi
			continue
		fi

		if ! command -v mwan3 >/dev/null 2>&1; then
			log warning "mwan3 is unavailable; retrying status in ${MAIN_LOOP_SLEEP}s."
			controller_sleep "$MAIN_LOOP_SLEEP"
			if ((TEST_MODE == 1 && TEST_MAX_LOOPS > 0 && loop_count >= TEST_MAX_LOOPS)); then
				return 0
			fi
			continue
		fi
		status_output=$(mwan3 interfaces 2>/dev/null) || status_output=''
		if [[ -z $status_output ]]; then
			log warning "mwan3 status is unavailable; retrying in ${MAIN_LOOP_SLEEP}s."
			controller_sleep "$MAIN_LOOP_SLEEP"
			if ((TEST_MODE == 1 && TEST_MAX_LOOPS > 0 && loop_count >= TEST_MAX_LOOPS)); then
				return 0
			fi
			continue
		fi

		current_epoch
		current_time=$CURRENT_EPOCH
		for index in "${!INSTANCE_INTERFACES[@]}"; do
			interface=${INSTANCE_INTERFACES[$index]}
			line=$(interface_line_for "$status_output" "$interface")
			[[ -n $line ]] || continue
			case $line in
			*'tracking is down'*) continue ;;
			esac
			status=$(awk '{print $4; exit}' <<<"$line")
			if [[ $status == online ]]; then
				if ((INSTANCE_BASE_DELAYS[index] != INITIAL_RETRY_DELAY)); then
					log debug "$interface is online; resetting its retry base."
				fi
				INSTANCE_BASE_DELAYS[index]=$INITIAL_RETRY_DELAY
				INSTANCE_SCHEDULED_DELAYS[index]=$INITIAL_RETRY_DELAY
				continue
			fi
			[[ $status == offline ]] || continue

			if ((INSTANCE_ATTEMPTED[index] == 1)); then
				elapsed=$((current_time - INSTANCE_LAST_ATTEMPTS[index]))
				if ((elapsed < INSTANCE_SCHEDULED_DELAYS[index])); then
					continue
				fi
			fi
			login_interface "$index" || :
			INSTANCE_LAST_ATTEMPTS[index]=$current_time
			INSTANCE_ATTEMPTED[index]=1
		done

		controller_sleep "$MAIN_LOOP_SLEEP"
		if ((TEST_MODE == 1 && TEST_MAX_LOOPS > 0 && loop_count >= TEST_MAX_LOOPS)); then
			return 0
		fi
	done
}

main() {
	local global_type global_enabled

	configure_test_mode
	global_type=$(uci -q get multilogin.global 2>/dev/null) || global_type=''
	if [[ -z $global_type ]]; then
		log error "UCI config 'multilogin' is missing global settings."
		return 1
	fi
	global_enabled=$(uci -q get multilogin.global.enabled 2>/dev/null) || global_enabled=''
	if [[ $global_enabled != 1 ]]; then
		log notice 'MultiLogin is disabled in global settings; exiting.'
		return 0
	fi

	load_settings
	load_instances
	if ((${#INSTANCE_INTERFACES[@]} == 0)); then
		log warning 'No enabled valid login instances; daemon is idle.'
	else
		log info "Starting multi-WAN auto-login daemon with ${#INSTANCE_INTERFACES[@]} instance(s)."
	fi
	run_loop
}

main "$@"
