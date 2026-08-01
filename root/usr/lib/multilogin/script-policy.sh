#!/bin/sh
# Source-only Phase 5 policy predicates. Loading this file performs no I/O.
# BusyBox ash supports the local extension used to avoid leaking parser state.
# shellcheck disable=SC3012,SC3043

_ml_policy_uint() {
	case ${1:-} in
	*[!0-9]* | '') return 1 ;;
	0 | [1-9]*) return 0 ;;
	*) return 1 ;;
	esac
}

_ml_policy_hash() {
	case ${1:-} in
	*[!0-9a-f]* | '') return 1 ;;
	esac
	[ "${#1}" -eq 64 ]
}

_ml_policy_identifiers() {
	local values allow_leading_zero identifier rest
	values=$1
	allow_leading_zero=$2
	[ -n "$values" ] || return 1
	case ".$values." in
	*..* | *[!0-9A-Za-z.-]*) return 1 ;;
	esac
	rest=$values
	while :; do
		identifier=${rest%%.*}
		case $identifier in
		*[!0-9]*) ;;
		0) ;;
		[1-9]*) ;;
		*) [ "$allow_leading_zero" = 1 ] || return 1 ;;
		esac
		[ "$rest" = "$identifier" ] && break
		rest=${rest#*.}
	done
	return 0
}

_ml_policy_semver_parse() {
	local value main build core prerelease old_ifs
	value=$1
	[ -n "$value" ] || return 1
	case $value in
	*[!0-9A-Za-z.+-]*) return 1 ;;
	esac

	main=${value%%+*}
	if [ "$main" != "$value" ]; then
		build=${value#*+}
		[ "${build#*+}" = "$build" ] || return 1
		_ml_policy_identifiers "$build" 1 || return 1
	fi

	core=${main%%-*}
	if [ "$core" != "$main" ]; then
		prerelease=${main#*-}
		_ml_policy_identifiers "$prerelease" 0 || return 1
	else
		prerelease=''
	fi

	old_ifs=$IFS
	IFS=.
	# shellcheck disable=SC2086
	set -- $core
	IFS=$old_ifs
	[ "$#" -eq 3 ] || return 1
	_ml_policy_uint "$1" && _ml_policy_uint "$2" && _ml_policy_uint "$3" || return 1
	ML_POLICY_MAJOR=$1
	ML_POLICY_MINOR=$2
	ML_POLICY_PATCH=$3
	ML_POLICY_PRERELEASE=$prerelease
	return 0
}

_ml_policy_numeric_compare() {
	local left right left_length right_length LC_ALL
	left=$1
	right=$2
	left_length=${#left}
	right_length=${#right}
	if [ "$left_length" -lt "$right_length" ]; then
		printf '%s\n' -1
	elif [ "$left_length" -gt "$right_length" ]; then
		printf '%s\n' 1
	elif [ "$left" = "$right" ]; then
		printf '%s\n' 0
	else
		LC_ALL=C
		export LC_ALL
		if [ "$left" \< "$right" ]; then
			printf '%s\n' -1
		else
			printf '%s\n' 1
		fi
	fi
}

_ml_policy_identifier_compare() {
	local left right left_numeric right_numeric LC_ALL
	left=$1
	right=$2
	left_numeric=0
	right_numeric=0
	case $left in *[!0-9]*) ;; *) left_numeric=1 ;; esac
	case $right in *[!0-9]*) ;; *) right_numeric=1 ;; esac
	if [ "$left_numeric" = 1 ] && [ "$right_numeric" = 1 ]; then
		_ml_policy_numeric_compare "$left" "$right"
	elif [ "$left_numeric" = 1 ]; then
		printf '%s\n' -1
	elif [ "$right_numeric" = 1 ]; then
		printf '%s\n' 1
	elif [ "$left" = "$right" ]; then
		printf '%s\n' 0
	else
		LC_ALL=C
		export LC_ALL
		if [ "$left" \< "$right" ]; then
			printf '%s\n' -1
		else
			printf '%s\n' 1
		fi
	fi
}

ml_policy_semver_compare() {
	local left right left_major left_minor left_patch left_pre right_major right_minor right_patch right_pre result left_id right_id
	left=${1:-}
	right=${2:-}
	_ml_policy_semver_parse "$left" || {
		printf '%s\n' invalid
		return
	}
	left_major=$ML_POLICY_MAJOR
	left_minor=$ML_POLICY_MINOR
	left_patch=$ML_POLICY_PATCH
	left_pre=$ML_POLICY_PRERELEASE
	_ml_policy_semver_parse "$right" || {
		printf '%s\n' invalid
		return
	}
	right_major=$ML_POLICY_MAJOR
	right_minor=$ML_POLICY_MINOR
	right_patch=$ML_POLICY_PATCH
	right_pre=$ML_POLICY_PRERELEASE

	for result in "$left_major:$right_major" "$left_minor:$right_minor" "$left_patch:$right_patch"; do
		left_id=${result%:*}
		right_id=${result#*:}
		result=$(_ml_policy_numeric_compare "$left_id" "$right_id")
		[ "$result" = 0 ] || {
			printf '%s\n' "$result"
			return
		}
	done

	if [ -z "$left_pre" ] && [ -z "$right_pre" ]; then
		printf '%s\n' 0
		return
	elif [ -z "$left_pre" ]; then
		printf '%s\n' 1
		return
	elif [ -z "$right_pre" ]; then
		printf '%s\n' -1
		return
	fi

	while [ -n "$left_pre" ] || [ -n "$right_pre" ]; do
		[ -n "$left_pre" ] || {
			printf '%s\n' -1
			return
		}
		[ -n "$right_pre" ] || {
			printf '%s\n' 1
			return
		}
		left_id=${left_pre%%.*}
		right_id=${right_pre%%.*}
		result=$(_ml_policy_identifier_compare "$left_id" "$right_id")
		[ "$result" = 0 ] || {
			printf '%s\n' "$result"
			return
		}
		if [ "$left_pre" = "$left_id" ]; then left_pre=''; else left_pre=${left_pre#*.}; fi
		if [ "$right_pre" = "$right_id" ]; then right_pre=''; else right_pre=${right_pre#*.}; fi
	done
	printf '%s\n' 0
}

ml_policy_relation() {
	local active_version remote_version active_hash remote_hash comparison
	active_version=${1:-}
	remote_version=${2:-}
	active_hash=${3:-}
	remote_hash=${4:-}
	comparison=$(ml_policy_semver_compare "$active_version" "$remote_version")
	[ "$comparison" != invalid ] || {
		printf '%s\n' unknown
		return
	}
	if _ml_policy_hash "$active_hash" && [ "$active_hash" = "$remote_hash" ]; then
		printf '%s\n' identical
		return
	fi
	case $comparison in
	-1) printf '%s\n' newer ;;
	0) printf '%s\n' same_version_changed ;;
	1) printf '%s\n' older ;;
	*) printf '%s\n' unknown ;;
	esac
}

ml_policy_request_fields() {
	local method actual expected
	method=${1:-}
	actual=${2:-}
	case $method in
	script_info | script_check | script_get_draft) expected='' ;;
	script_stage) expected='expected_generation' ;;
	script_validate) expected='confirm_execute expected_generation expected_sha256 source' ;;
	script_activate) expected='allow_downgrade confirm_activate expected_generation expected_sha256 source' ;;
	script_rollback | script_restore) expected='confirm_activate expected_generation expected_sha256' ;;
	script_save_draft) expected='base_sha256 content expected_generation' ;;
	script_discard_draft) expected='expected_generation expected_sha256' ;;
	*)
		printf '%s\n' invalid_request
		return
		;;
	esac
	if [ "$actual" = "$expected" ]; then printf '%s\n' ok; else printf '%s\n' invalid_request; fi
}

ml_policy_transition() {
	local operation status current_hash target_hash
	operation=${1:-}
	status=${2:-}
	current_hash=${3:-}
	target_hash=${4:-}
	case $current_hash in '') ;; *) _ml_policy_hash "$current_hash" || {
		printf '%s\n' invalid_request
		return
	} ;; esac
	case $target_hash in '') ;; *) _ml_policy_hash "$target_hash" || {
		printf '%s\n' invalid_request
		return
	} ;; esac
	case $operation in
	stage | save_draft)
		if ! _ml_policy_hash "$target_hash"; then
			printf '%s\n' invalid_request
			return
		fi
		;;
	validate | activate | rollback | restore)
		if ! _ml_policy_hash "$current_hash" || ! _ml_policy_hash "$target_hash"; then
			printf '%s\n' invalid_request
			return
		fi
		;;
	discard_draft)
		if [ "$status" != none ] && { ! _ml_policy_hash "$current_hash" || ! _ml_policy_hash "$target_hash"; }; then
			printf '%s\n' invalid_request
			return
		fi
		;;
	esac
	case $operation in
	stage)
		if [ -n "$current_hash" ] && [ "$current_hash" = "$target_hash" ]; then printf '%s\n' no_change; else printf '%s\n' ok; fi
		;;
	validate)
		case $status in
		validated) [ "$current_hash" = "$target_hash" ] && printf '%s\n' no_change || printf '%s\n' conflict ;;
		staged | draft) [ "$current_hash" = "$target_hash" ] && printf '%s\n' ok || printf '%s\n' conflict ;;
		*) printf '%s\n' invalid_state ;;
		esac
		;;
	activate)
		[ "$status" = validated ] || {
			printf '%s\n' invalid_state
			return
		}
		if [ -n "$current_hash" ] && [ "$current_hash" = "$target_hash" ]; then printf '%s\n' no_change; else printf '%s\n' ok; fi
		;;
	rollback | restore)
		[ "$status" = available ] || {
			printf '%s\n' invalid_state
			return
		}
		if [ -n "$current_hash" ] && [ "$current_hash" = "$target_hash" ]; then printf '%s\n' no_change; else printf '%s\n' ok; fi
		;;
	save_draft)
		if [ -n "$current_hash" ] && [ "$current_hash" = "$target_hash" ]; then printf '%s\n' no_change; else printf '%s\n' ok; fi
		;;
	discard_draft)
		case $status in none) printf '%s\n' not_found ;; draft | validated) printf '%s\n' ok ;; *) printf '%s\n' invalid_state ;; esac
		;;
	*) printf '%s\n' invalid_state ;;
	esac
}

ml_policy_generation() {
	local expected current
	expected=${1:-}
	current=${2:-}
	if ! _ml_policy_uint "$expected" || ! _ml_policy_uint "$current"; then
		printf '%s\n' invalid_request
	elif [ "$expected" = "$current" ]; then
		printf '%s\n' ok
	else
		printf '%s\n' conflict
	fi
}

ml_policy_boolean() {
	case ${1:-} in true | false) printf '%s\n' ok ;; *) printf '%s\n' invalid_request ;; esac
}

ml_policy_http() {
	local status effective fixed
	status=${1:-}
	effective=${2:-}
	fixed='https://raw.githubusercontent.com/Zesuy/luci-app-multi-login/main/etc/multilogin/cqu-portal.sh'
	case $status in
	200) if [ "$effective" = "$fixed" ]; then printf '%s\n' ok; else printf '%s\n' source_rejected; fi ;;
	3[0-9][0-9]) printf '%s\n' source_rejected ;;
	*) printf '%s\n' download_failed ;;
	esac
}

ml_policy_content_file() {
	local file size
	file=${1:-}
	if [ ! -f "$file" ] || [ -L "$file" ]; then
		printf '%s\n' invalid_request
		return
	fi
	size=$(wc -c <"$file" 2>/dev/null) || {
		printf '%s\n' invalid_request
		return
	}
	if ! [ "$size" -gt 0 ] 2>/dev/null || ! [ "$size" -le 262144 ] 2>/dev/null; then
		printf '%s\n' invalid_request
		return
	fi
	if od -An -tu1 -v "$file" 2>/dev/null | awk '
		BEGIN { need = 0; min = 0; max = 0; ok = 1 }
		{
			for (i = 1; i <= NF; i++) {
				b = $i + 0
				if (b == 0) { ok = 0; exit }
				if (need > 0) {
					if (b < min || b > max) { ok = 0; exit }
					need--; min = 128; max = 191; continue
				}
				if (b <= 127) continue
				if (b >= 194 && b <= 223) { need = 1; min = 128; max = 191; continue }
				if (b == 224) { need = 2; min = 160; max = 191; continue }
				if (b >= 225 && b <= 236) { need = 2; min = 128; max = 191; continue }
				if (b == 237) { need = 2; min = 128; max = 159; continue }
				if (b >= 238 && b <= 239) { need = 2; min = 128; max = 191; continue }
				if (b == 240) { need = 3; min = 144; max = 191; continue }
				if (b >= 241 && b <= 243) { need = 3; min = 128; max = 191; continue }
				if (b == 244) { need = 3; min = 128; max = 143; continue }
				ok = 0; exit
			}
		}
		END { exit !(ok && need == 0) }
	'; then
		printf '%s\n' ok
	else
		printf '%s\n' invalid_request
	fi
}

ml_policy_downgrade() {
	local source active_version selected_version allow comparison
	source=${1:-}
	active_version=${2:-}
	selected_version=${3:-}
	allow=${4:-}
	[ "$(ml_policy_boolean "$allow")" = ok ] || {
		printf '%s\n' invalid_request
		return
	}
	case $source in
	custom) printf '%s\n' ok ;;
	candidate)
		[ "$(ml_policy_semver_compare "$selected_version" "$selected_version")" = 0 ] || {
			printf '%s\n' source_rejected
			return
		}
		if [ "$(ml_policy_semver_compare "$active_version" "$active_version")" = invalid ]; then
			printf '%s\n' ok
			return
		fi
		comparison=$(ml_policy_semver_compare "$selected_version" "$active_version")
		case $comparison:$allow in
		-1:false) printf '%s\n' confirmation_required ;;
		-1:true | 0:* | 1:*) printf '%s\n' ok ;;
		*) printf '%s\n' source_rejected ;;
		esac
		;;
	*) printf '%s\n' invalid_request ;;
	esac
}
