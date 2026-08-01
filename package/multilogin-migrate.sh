#!/bin/sh
# Shared, POSIX lifecycle implementation.  Package hooks embed this file so
# preinst never depends on a file that has not been unpacked yet.

ML_KNOWN_LOGIN_SHA='6ceef1565b393e692216f8c789d52a5fe533df35f1db243eb90527c61d95b380'
ML_KNOWN_STATUS_SHA='24ae7e4190701786f39111e7a15210e8d3fa52fd1d25157806e89035bf5a590e'
ML_KNOWN_LOGOUT_SHA='176e170723d8eef5fcc90cf160c50239c57213ff2c55e6b5a44a677f5b0ab5ca'
ML_KNOWN_HUXI_SHA='6ceef1565b393e692216f8c789d52a5fe533df35f1db243eb90527c61d95b380'
ML_KNOWN_A_SHA='2c8551c7b2e8af6c7f791640bbb1718ee97abf28245fa695637a41988e8eef94'

ml_die() {
	printf '%s\n' "multilogin migration: $*" >&2
	return 1
}

ml_init() {
	case ${IPKG_INSTROOT:-} in
	/*) ML_ROOT=${IPKG_INSTROOT%/} ;;
	'') ML_ROOT=/ ;;
	*) ml_die 'IPKG_INSTROOT must be absolute' || return 1 ;;
	esac
	[ -n "$ML_ROOT" ] || ML_ROOT=/
	ML_MIGRATION_DIR="$ML_ROOT/etc/multilogin/.migration-v3"
	ML_STATE="$ML_MIGRATION_DIR/state"
	ML_MANIFEST="$ML_MIGRATION_DIR/manifest"
	ML_LOCK="$ML_ROOT/var/lock/multilogin-migrate.lock"
	return 0
}

ml_path() { printf '%s%s' "$ML_ROOT" "$1"; }
ml_live_root() { [ "$ML_ROOT" = / ] && [ -z "${IPKG_INSTROOT:-}" ]; }

ml_sha256() {
	if command -v sha256sum >/dev/null 2>&1; then
		sha256sum "$1" 2>/dev/null | awk '{print $1}'
	elif command -v busybox >/dev/null 2>&1; then
		busybox sha256sum "$1" 2>/dev/null | awk '{print $1}'
	else
		return 1
	fi
}

ml_mode() { stat -c '%a' "$1" 2>/dev/null || busybox stat -c '%a' "$1" 2>/dev/null; }

ml_atomic_from_stdin() {
	ML_ATOMIC_TARGET=$1
	ML_ATOMIC_MODE=$2
	ML_ATOMIC_DIR=${ML_ATOMIC_TARGET%/*}
	[ "$ML_ATOMIC_DIR" != "$ML_ATOMIC_TARGET" ] || return 1
	mkdir -p "$ML_ATOMIC_DIR" || return 1
	ML_ATOMIC_TMP=$(umask 077 && mktemp "$ML_ATOMIC_DIR/.multilogin-migrate.XXXXXX") || return 1
	case $ML_ATOMIC_TMP in "$ML_ATOMIC_DIR"/.multilogin-migrate.*) ;; *) return 1 ;; esac
	[ -f "$ML_ATOMIC_TMP" ] && [ ! -L "$ML_ATOMIC_TMP" ] || return 1
	(umask 077 && cat >"$ML_ATOMIC_TMP") || {
		rm -f "$ML_ATOMIC_TMP"
		return 1
	}
	chmod "$ML_ATOMIC_MODE" "$ML_ATOMIC_TMP" || {
		rm -f "$ML_ATOMIC_TMP"
		return 1
	}
	mv -f "$ML_ATOMIC_TMP" "$ML_ATOMIC_TARGET"
}

ml_atomic_copy() {
	ML_COPY_SOURCE=$1
	ML_COPY_TARGET=$2
	ML_COPY_MODE=$3
	[ -f "$ML_COPY_SOURCE" ] && [ ! -L "$ML_COPY_SOURCE" ] || return 1
	ml_atomic_from_stdin "$ML_COPY_TARGET" "$ML_COPY_MODE" <"$ML_COPY_SOURCE"
}

ml_set_state() {
	ML_NEXT_STATE=$1
	{
		printf 'generation=%s\n' "${ML_GENERATION:-unknown}"
		printf 'state=%s\n' "$ML_NEXT_STATE"
		printf 'kind=%s\n' "${ML_KIND:-unknown}"
		printf 'source_version=%s\n' "${ML_SOURCE_VERSION:-unknown}"
	} | ml_atomic_from_stdin "$ML_STATE" 0600 || return 1
	return 0
}

ml_current_state() { sed -n 's/^state=//p' "$ML_STATE" 2>/dev/null | sed -n '1p'; }
ml_current_kind() { sed -n 's/^kind=//p' "$ML_STATE" 2>/dev/null | sed -n '1p'; }
ml_current_generation() { sed -n 's/^generation=//p' "$ML_STATE" 2>/dev/null | sed -n '1p'; }
ml_current_source_version() { sed -n 's/^source_version=//p' "$ML_STATE" 2>/dev/null | sed -n '1p'; }

ml_new_generation() {
	mkdir -p "$ML_MIGRATION_DIR" || return 1
	chmod 0700 "$ML_MIGRATION_DIR" || return 1
	ML_GENERATION_DIR=$(umask 077 && mktemp -d "$ML_MIGRATION_DIR/.generation.XXXXXX") || return 1
	case $ML_GENERATION_DIR in "$ML_MIGRATION_DIR"/.generation.*) ;; *) return 1 ;; esac
	ML_GENERATION=${ML_GENERATION_DIR##*/.generation.}
	rmdir "$ML_GENERATION_DIR" || return 1
}

ml_acquire_lock() {
	mkdir -p "${ML_LOCK%/*}" || return 1
	if ! (umask 077 && mkdir "${ML_LOCK}.d") 2>/dev/null; then
		if [ ! -d "${ML_LOCK}.d" ] || [ -L "${ML_LOCK}.d" ]; then
			ml_die 'unsafe migration lock directory'
			return 1
		fi
		if [ ! -f "${ML_LOCK}.d/pid" ] || [ -L "${ML_LOCK}.d/pid" ]; then
			ml_die 'unsafe migration lock pid'
			return 1
		fi
		[ "$(find "${ML_LOCK}.d" -mindepth 1 -maxdepth 1 -type f | wc -l)" -eq 1 ] || {
			ml_die 'unsafe stale lock'
			return 1
		}
		grep -qx 'pid=[0-9][0-9]*' "${ML_LOCK}.d/pid" || {
			ml_die 'migration lock is held'
			return 1
		}
		ML_LOCK_PID=$(sed -n 's/^pid=//p' "${ML_LOCK}.d/pid" | sed -n '1p')
		case $ML_LOCK_PID in
		*[!0-9]* | '')
			ml_die 'migration lock is held'
			return 1
			;;
		esac
		if kill -0 "$ML_LOCK_PID" 2>/dev/null; then
			ml_die 'migration lock is held'
			return 1
		fi
		# A dead PID is recoverable only when the lock directory has the exact
		# expected shape; never remove an unknown concurrent writer's state.
		if [ -e "$ML_LOCK" ] || [ -L "$ML_LOCK" ]; then
			if [ ! -f "$ML_LOCK" ] || [ -L "$ML_LOCK" ]; then
				ml_die 'unsafe migration lock file'
				return 1
			fi
		fi
		rm -f "${ML_LOCK}.d/pid" "$ML_LOCK" || return 1
		rmdir "${ML_LOCK}.d" || return 1
		(umask 077 && mkdir "${ML_LOCK}.d") || return 1
	fi
	(umask 077 && set -C && : >"$ML_LOCK") || {
		rmdir "${ML_LOCK}.d" 2>/dev/null || :
		return 1
	}
	if [ ! -f "$ML_LOCK" ] || [ -L "$ML_LOCK" ]; then
		rm -f "$ML_LOCK"
		rmdir "${ML_LOCK}.d" 2>/dev/null || :
		return 1
	fi
	(umask 077 && set -C && printf 'pid=%s\n' "$$" >"${ML_LOCK}.d/pid") || {
		rm -f "$ML_LOCK"
		rmdir "${ML_LOCK}.d" 2>/dev/null || :
		return 1
	}
	chmod 0600 "$ML_LOCK" "${ML_LOCK}.d/pid" || {
		rm -f "${ML_LOCK}.d/pid" "$ML_LOCK"
		rmdir "${ML_LOCK}.d" 2>/dev/null || :
		return 1
	}
	trap 'ml_release_lock' EXIT
	trap 'ml_signal' HUP INT TERM
}

ml_release_lock() {
	rm -f "${ML_LOCK}.d/pid" "$ML_LOCK" 2>/dev/null || :
	rmdir "${ML_LOCK}.d" 2>/dev/null || :
	trap - EXIT HUP INT TERM
}

ml_signal() {
	ml_release_lock
	exit 3
}

ml_check_space() {
	ML_FREE_KB=$(df -Pk "$ML_ROOT" 2>/dev/null | awk 'NR==2 {print $4}')
	case $ML_FREE_KB in '' | *[!0-9]*)
		ml_die 'cannot verify free space'
		return 1
		;;
	esac
	if [ "$ML_FREE_KB" -lt 256 ]; then
		ml_die 'insufficient free space'
		return 1
	fi
	return 0
}

ml_is_upgrade() { [ "${PKG_UPGRADE:-0}" = 1 ] || [ "${1:-}" = upgrade ]; }

ml_service_snapshot() {
	ML_SERVICE_ENABLED=0
	ML_SERVICE_RUNNING=0
	if ml_live_root; then
		set -- /etc/rc.d/S??multilogin
		[ -e "$1" ] && ML_SERVICE_ENABLED=1
		/etc/init.d/multilogin running >/dev/null 2>&1 && ML_SERVICE_RUNNING=1
		[ "$ML_SERVICE_RUNNING" = 1 ] || /etc/init.d/multilogin status >/dev/null 2>&1 && ML_SERVICE_RUNNING=1
	fi
	printf 'enabled=%s\nrunning=%s\n' "$ML_SERVICE_ENABLED" "$ML_SERVICE_RUNNING" |
		ml_atomic_from_stdin "$ML_MIGRATION_DIR/service.before" 0600
}

ml_service_actions_enabled() { ml_live_root; }

ml_service_action() {
	ML_SERVICE_ACTION=$1
	case $ML_SERVICE_ACTION in enable | disable | start | stop | restart) ;; *) return 1 ;; esac
	if ml_live_root; then
		"/etc/init.d/multilogin" "$ML_SERVICE_ACTION"
	fi
}

ml_snapshot_one() {
	ML_SNAPSHOT_NAME=$1
	ML_SNAPSHOT_PATH=$(ml_path "/etc/multilogin/$ML_SNAPSHOT_NAME")
	if [ -e "$ML_SNAPSHOT_PATH" ] || [ -L "$ML_SNAPSHOT_PATH" ]; then
		[ -f "$ML_SNAPSHOT_PATH" ] && [ ! -L "$ML_SNAPSHOT_PATH" ] || return 1
		ML_SNAPSHOT_HASH=$(ml_sha256 "$ML_SNAPSHOT_PATH") || return 1
		ML_SNAPSHOT_MODE=$(ml_mode "$ML_SNAPSHOT_PATH") || return 1
		ml_atomic_copy "$ML_SNAPSHOT_PATH" "$ML_MIGRATION_DIR/legacy/$ML_SNAPSHOT_NAME" "$ML_SNAPSHOT_MODE" || return 1
		printf '%s|present|%s|%s\n' "$ML_SNAPSHOT_NAME" "$ML_SNAPSHOT_HASH" "$ML_SNAPSHOT_MODE" >>"$ML_MIGRATION_DIR/legacy.index"
	else
		printf '%s|absent||\n' "$ML_SNAPSHOT_NAME" >>"$ML_MIGRATION_DIR/legacy.index"
	fi
}

ml_snapshot() {
	mkdir -p "$ML_MIGRATION_DIR/legacy" || return 1
	chmod 0700 "$ML_MIGRATION_DIR" "$ML_MIGRATION_DIR/legacy" || return 1
	: >"$ML_MIGRATION_DIR/legacy.index" || return 1
	chmod 0600 "$ML_MIGRATION_DIR/legacy.index" || return 1
	for ML_LEGACY in login.sh check_status.sh logout.sh login_huxi.sh login_A.sh; do
		ml_snapshot_one "$ML_LEGACY" || return 1
	done
	ML_CONFIG=$(ml_path /etc/config/multilogin)
	if [ -e "$ML_CONFIG" ] || [ -L "$ML_CONFIG" ]; then
		[ -f "$ML_CONFIG" ] && [ ! -L "$ML_CONFIG" ] || return 1
		ml_atomic_copy "$ML_CONFIG" "$ML_MIGRATION_DIR/config.before" "$(ml_mode "$ML_CONFIG")" || return 1
	fi
	ML_ACTIVE=$(ml_path /etc/multilogin/cqu-portal.sh)
	if [ -e "$ML_ACTIVE" ] || [ -L "$ML_ACTIVE" ]; then
		[ -f "$ML_ACTIVE" ] && [ ! -L "$ML_ACTIVE" ] || return 1
		ml_atomic_copy "$ML_ACTIVE" "$ML_MIGRATION_DIR/active.before" "$(ml_mode "$ML_ACTIVE")" || return 1
		printf 'active_present=1\nactive_sha256=%s\n' "$(ml_sha256 "$ML_ACTIVE")" >>"$ML_MIGRATION_DIR/legacy.index"
	else
		printf 'active_present=0\n' >>"$ML_MIGRATION_DIR/legacy.index"
	fi
	ML_SCRIPT_STATE=$(ml_path /etc/multilogin/.script-state)
	if [ -e "$ML_SCRIPT_STATE" ] || [ -L "$ML_SCRIPT_STATE" ]; then
		[ -d "$ML_SCRIPT_STATE" ] && [ ! -L "$ML_SCRIPT_STATE" ] || return 1
		if find "$ML_SCRIPT_STATE" -type l -print -quit 2>/dev/null | grep -q .; then
			ml_die 'script state contains a symlink'
			return 1
		fi
		ML_SCRIPT_SNAPSHOT="$ML_MIGRATION_DIR/script-state.${ML_GENERATION}"
		[ ! -e "$ML_SCRIPT_SNAPSHOT" ] || {
			ml_die 'script-state snapshot already exists'
			return 1
		}
		ML_SCRIPT_STAGE=$(umask 077 && mktemp -d "$ML_MIGRATION_DIR/.script-state.XXXXXX") || return 1
		cp -Rp "$ML_SCRIPT_STATE/." "$ML_SCRIPT_STAGE" || {
			rm -rf "$ML_SCRIPT_STAGE"
			return 1
		}
		chmod -R go-rwx "$ML_SCRIPT_STAGE" || {
			rm -rf "$ML_SCRIPT_STAGE"
			return 1
		}
		mv "$ML_SCRIPT_STAGE" "$ML_SCRIPT_SNAPSHOT" || {
			rm -rf "$ML_SCRIPT_STAGE"
			return 1
		}
		printf 'script_state_present=1\nscript_state_snapshot=%s\n' "${ML_SCRIPT_SNAPSHOT#"$ML_ROOT"}" >>"$ML_MIGRATION_DIR/legacy.index"
	else
		printf 'script_state_present=0\n' >>"$ML_MIGRATION_DIR/legacy.index"
	fi
	ml_service_snapshot || return 1
}

ml_known_hash() {
	case "$1:$2" in
	login.sh:"$ML_KNOWN_LOGIN_SHA" | check_status.sh:"$ML_KNOWN_STATUS_SHA" | logout.sh:"$ML_KNOWN_LOGOUT_SHA" | login_huxi.sh:"$ML_KNOWN_HUXI_SHA" | login_A.sh:"$ML_KNOWN_A_SHA") return 0 ;;
	esac
	return 1
}

ml_classify() {
	ML_RUNTIME_STATE=$(ml_path /etc/multilogin/.script-state)
	if [ -e "$ML_RUNTIME_STATE" ] || [ -L "$ML_RUNTIME_STATE" ]; then
		[ -d "$ML_RUNTIME_STATE" ] && [ ! -L "$ML_RUNTIME_STATE" ] || return 1
	fi
	mkdir -p "$ML_MIGRATION_DIR/preserved" "$ML_RUNTIME_STATE" || return 1
	chmod 0700 "$ML_MIGRATION_DIR/preserved" "$ML_RUNTIME_STATE" || return 1
	: >"$ML_MANIFEST" || return 1
	chmod 0600 "$ML_MANIFEST" || return 1
	ML_SELECTED=''
	while IFS='|' read -r ML_NAME ML_PRESENT ML_HASH ML_FILEMODE; do
		case $ML_PRESENT in present) ;; *) continue ;; esac
		if ml_known_hash "$ML_NAME" "$ML_HASH"; then
			printf '%s|stock|%s|%s\n' "$ML_NAME" "$ML_HASH" "$ML_FILEMODE" >>"$ML_MANIFEST"
		else
			ML_PRESERVED="$ML_MIGRATION_DIR/preserved/$ML_NAME.$ML_HASH"
			ml_atomic_copy "$ML_MIGRATION_DIR/legacy/$ML_NAME" "$ML_PRESERVED" "$ML_FILEMODE" || return 1
			printf '%s|custom|%s|%s|%s\n' "$ML_NAME" "$ML_HASH" "$ML_FILEMODE" "${ML_PRESERVED#"$ML_ROOT"}" >>"$ML_MANIFEST"
		fi
	done <"$ML_MIGRATION_DIR/legacy.index"
	# A single compatibility backup must prefer code that can plausibly be a
	# login implementation.  Every unknown bundle remains preserved above.
	for ML_PRIORITY in login.sh login_huxi.sh login_A.sh logout.sh check_status.sh; do
		ML_SELECTED_REL=$(awk -F '|' -v name="$ML_PRIORITY" '$1 == name && $2 == "custom" { print $5; exit }' "$ML_MANIFEST")
		[ -n "$ML_SELECTED_REL" ] && {
			ML_SELECTED="$ML_ROOT$ML_SELECTED_REL"
			break
		}
	done
	if [ -n "$ML_SELECTED" ]; then
		ml_atomic_copy "$ML_SELECTED" "$(ml_path /etc/multilogin/.script-state/custom.preserved.sh)" 0600 || return 1
		printf 'custom_preserved=%s\n' "${ML_SELECTED#"$ML_ROOT"}" >>"$ML_MANIFEST"
	fi
	# These two obsolete templates are no longer package paths.  Retire the
	# original only after its pre-unpack copy was classified; an unknown copy is
	# still retained in `preserved/` and never selected for execution.
	for ML_TEMPLATE in login_huxi.sh login_A.sh; do
		ML_TEMPLATE_HASH=$(awk -F '|' -v name="$ML_TEMPLATE" '$1 == name && $2 == "present" { print $3; exit }' "$ML_MIGRATION_DIR/legacy.index")
		ML_TEMPLATE_PATH=$(ml_path "/etc/multilogin/$ML_TEMPLATE")
		if [ -n "$ML_TEMPLATE_HASH" ] && [ -f "$ML_TEMPLATE_PATH" ] && [ ! -L "$ML_TEMPLATE_PATH" ] && [ "$(ml_sha256 "$ML_TEMPLATE_PATH")" = "$ML_TEMPLATE_HASH" ]; then
			rm -f "$ML_TEMPLATE_PATH" || return 1
			printf '%s|retired|%s\n' "$ML_TEMPLATE" "$ML_TEMPLATE_HASH" >>"$ML_MANIFEST"
		fi
	done
	return 0
}

ml_install_active() {
	ML_ACTIVE=$(ml_path /etc/multilogin/cqu-portal.sh)
	ML_FACTORY=$(ml_path /usr/lib/multilogin/cqu-portal.factory.sh)
	if [ ! -f "$ML_FACTORY" ] || [ -L "$ML_FACTORY" ]; then
		ml_die 'factory script missing'
		return 1
	fi
	sh -n "$ML_FACTORY" || {
		ml_die 'factory script has invalid syntax'
		return 1
	}
	if [ -e "$ML_ACTIVE" ]; then
		if [ ! -f "$ML_ACTIVE" ] || [ -L "$ML_ACTIVE" ]; then
			ml_die 'active script is unsafe'
			return 1
		fi
		printf 'state=active_preserved\n' | ml_atomic_from_stdin "$ML_MIGRATION_DIR/active.journal" 0600
		return $?
	fi
	printf 'state=installing_factory\n' | ml_atomic_from_stdin "$ML_MIGRATION_DIR/active.journal" 0600 || return 1
	ml_atomic_copy "$ML_FACTORY" "$ML_ACTIVE" 0755 || return 1
	printf 'state=installed_factory\n' | ml_atomic_from_stdin "$ML_MIGRATION_DIR/active.journal" 0600
}

ml_restore_service() {
	ML_WAS_ENABLED=$(sed -n 's/^enabled=//p' "$ML_MIGRATION_DIR/service.before" 2>/dev/null | sed -n '1p')
	ML_WAS_RUNNING=$(sed -n 's/^running=//p' "$ML_MIGRATION_DIR/service.before" 2>/dev/null | sed -n '1p')
	case $ML_WAS_ENABLED in 0 | 1) ;; *) ML_WAS_ENABLED=0 ;; esac
	case $ML_WAS_RUNNING in 0 | 1) ;; *) ML_WAS_RUNNING=0 ;; esac
	if ml_service_actions_enabled; then
		if [ "${ML_KIND:-}" = fresh ]; then
			ml_service_action enable || return 1
		else
			if [ "$ML_WAS_ENABLED" = 1 ]; then ml_service_action enable; else ml_service_action disable; fi || return 1
			if [ "$ML_WAS_RUNNING" = 1 ]; then ml_service_action restart; else ml_service_action stop; fi || return 1
		fi
	fi
	return 0
}

ml_preinst() {
	ml_init || return 1
	ml_acquire_lock || return 1
	ML_KIND=fresh
	ML_SOURCE_VERSION=none
	if ml_is_upgrade "$@"; then
		ML_KIND=upgrade
		ML_SOURCE_VERSION=${2:-unknown}
	fi
	ML_EXISTING=$(ml_current_state)
	if [ "$ML_EXISTING" = prepared ] || [ "$ML_EXISTING" = unpacked ] || [ "$ML_EXISTING" = classified ] || [ "$ML_EXISTING" = installed ] || [ "$ML_EXISTING" = service_restored ]; then return 0; fi
	ml_new_generation || return 1
	ml_check_space || return 1
	ml_snapshot || return 1
	ml_set_state prepared
}

ml_postinst() {
	ml_init || return 1
	ml_acquire_lock || return 1
	ML_KIND=$(ml_current_kind)
	[ -n "$ML_KIND" ] || ML_KIND=fresh
	ML_GENERATION=$(ml_current_generation)
	[ -n "$ML_GENERATION" ] || return 1
	ML_SOURCE_VERSION=$(ml_current_source_version)
	[ -n "$ML_SOURCE_VERSION" ] || ML_SOURCE_VERSION=unknown
	ML_EXISTING=$(ml_current_state)
	case $ML_EXISTING in
	prepared)
		ml_set_state unpacked || return 1
		ML_EXISTING=unpacked
		;;
	'') return 1 ;;
	esac
	if [ "$ML_EXISTING" = unpacked ]; then
		ml_classify || return 1
		ml_set_state classified || return 1
		ML_EXISTING=classified
	fi
	if [ "$ML_EXISTING" = classified ]; then
		ml_install_active || return 1
		ml_set_state installed || return 1
		ML_EXISTING=installed
	fi
	if [ "$ML_EXISTING" = installed ]; then
		ml_restore_service || return 1
		ml_set_state service_restored || return 1
		ML_EXISTING=service_restored
	fi
	if [ "$ML_EXISTING" = service_restored ]; then
		ml_set_state complete || return 1
		return 0
	fi
	[ "$ML_EXISTING" = complete ] && return 0
	return 1
}

ml_prepare_downgrade() {
	ml_init || return 1
	ml_acquire_lock || return 1
	ml_is_upgrade "$@" || return 0
	ML_TARGET=${2:-${PKG_NEW_VERSION:-}}
	[ "$ML_TARGET" = 2.2.0-4 ] || {
		ml_die 'unsupported downgrade target'
		return 1
	}
	ML_DOWN="$ML_MIGRATION_DIR/downgrade-state"
	mkdir -p "$ML_DOWN" || return 1
	chmod 0700 "$ML_DOWN" || return 1
	case $(sed -n 's/^state=//p' "$ML_DOWN/manifest" 2>/dev/null | sed -n '1p') in
	complete) return 0 ;;
	prepared)
		ml_write_downgrade_finalizer
		return $?
		;;
	esac
	ML_DOWN_GENERATION=$(ml_current_generation)
	[ -n "$ML_DOWN_GENERATION" ] || {
		ml_new_generation || return 1
		ML_DOWN_GENERATION=$ML_GENERATION
	}
	ML_D_CONFIG=$(ml_path /etc/config/multilogin)
	ML_D_ACTIVE=$(ml_path /etc/multilogin/cqu-portal.sh)
	if [ ! -f "$ML_D_CONFIG" ] || [ -L "$ML_D_CONFIG" ]; then
		ml_die 'downgrade config snapshot is unavailable'
		return 1
	fi
	if [ ! -f "$ML_D_ACTIVE" ] || [ -L "$ML_D_ACTIVE" ]; then
		ml_die 'downgrade active script snapshot is unavailable'
		return 1
	fi
	ML_D_CONFIG_SHA=$(ml_sha256 "$ML_D_CONFIG") || return 1
	ML_D_ACTIVE_SHA=$(ml_sha256 "$ML_D_ACTIVE") || return 1
	ML_D_CONFIG_MODE=$(ml_mode "$ML_D_CONFIG") || return 1
	ML_D_ACTIVE_MODE=$(ml_mode "$ML_D_ACTIVE") || return 1
	ml_atomic_copy "$ML_D_CONFIG" "$ML_DOWN/multilogin" "$ML_D_CONFIG_MODE" || return 1
	ml_atomic_copy "$ML_D_ACTIVE" "$ML_DOWN/cqu-portal.sh" "$ML_D_ACTIVE_MODE" || return 1
	ML_V3_STATE=$(ml_path /etc/multilogin/.script-state)
	ML_D_STATE_PATH=''
	if [ -d "$ML_V3_STATE" ] && [ ! -L "$ML_V3_STATE" ]; then
		if find "$ML_V3_STATE" -type l -print -quit 2>/dev/null | grep -q .; then
			ml_die 'downgrade script state contains a symlink'
			return 1
		fi
		ML_D_STATE_PATH="$ML_DOWN/script-state.$ML_DOWN_GENERATION"
		if [ -e "$ML_D_STATE_PATH" ]; then
			[ -d "$ML_D_STATE_PATH" ] && [ ! -L "$ML_D_STATE_PATH" ] || return 1
			find "$ML_D_STATE_PATH" -type l -print -quit 2>/dev/null | grep -q . && return 1
		else
			ML_D_STAGE=$(umask 077 && mktemp -d "$ML_DOWN/.script-state.XXXXXX") || return 1
			cp -Rp "$ML_V3_STATE/." "$ML_D_STAGE" || {
				rm -rf "$ML_D_STAGE"
				return 1
			}
			chmod -R go-rwx "$ML_D_STAGE" || {
				rm -rf "$ML_D_STAGE"
				return 1
			}
			mv "$ML_D_STAGE" "$ML_D_STATE_PATH" || {
				rm -rf "$ML_D_STAGE"
				return 1
			}
		fi
		ML_D_STATE_PATH=${ML_D_STATE_PATH#"$ML_ROOT"}
	fi
	ml_service_snapshot || return 1
	ml_atomic_copy "$ML_MIGRATION_DIR/service.before" "$ML_DOWN/service.before" 0600 || return 1
	{
		printf 'target=2.2.0-4\nsource=fb272e8285c65415dea8a9a359a4204b94be06a0\ngeneration=%s\n' "$ML_DOWN_GENERATION"
		printf 'config_sha256=%s\nconfig_mode=%s\nactive_sha256=%s\nactive_mode=%s\n' "$ML_D_CONFIG_SHA" "$ML_D_CONFIG_MODE" "$ML_D_ACTIVE_SHA" "$ML_D_ACTIVE_MODE"
		printf 'script_state=%s\nstate=prepared\n' "$ML_D_STATE_PATH"
	} | ml_atomic_from_stdin "$ML_DOWN/manifest" 0600 || return 1
	ml_write_downgrade_finalizer
}

ml_write_downgrade_finalizer() {
	ML_FINALIZER=$(ml_path /etc/uci-defaults/99-multilogin-v3-downgrade-finalize)
	mkdir -p "${ML_FINALIZER%/*}" || return 1
	cat <<'ML_FINALIZER_EOF' | ml_atomic_from_stdin "$ML_FINALIZER" 0700
#!/bin/sh
set -eu
root=${IPKG_INSTROOT:-/}
case $root in /*) ;; *) exit 1;; esac
p() { printf '%s%s' "${root%/}" "$1"; }
state=$(p /etc/multilogin/.migration-v3/downgrade-state)
manifest=$state/manifest
finalizer=$(p /etc/uci-defaults/99-multilogin-v3-downgrade-finalize)
lock=$(p /var/lock/multilogin-migrate.lock)
lock_dir=$lock.d
lock_owned=0
sha256() {
 if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$1" 2>/dev/null | awk '{print $1}'
 elif command -v busybox >/dev/null 2>&1; then
  busybox sha256sum "$1" 2>/dev/null | awk '{print $1}'
 else
  return 1
 fi
}
release_lock() {
 [ "$lock_owned" = 1 ] || return 0
 cleanup_pending_temps
 rm -f "$lock_dir/pid" "$lock" 2>/dev/null || :
 rmdir "$lock_dir" 2>/dev/null || :
 lock_owned=0
 trap - 0 HUP INT TERM
}
lock_signal() {
 release_lock
 exit 3
}
acquire_lock() {
 mkdir -p "${lock%/*}" || exit 1
 if ! (umask 077 && mkdir "$lock_dir") 2>/dev/null; then
  [ -d "$lock_dir" ] && [ ! -L "$lock_dir" ] || exit 1
  [ -f "$lock_dir/pid" ] && [ ! -L "$lock_dir/pid" ] || exit 1
  [ "$(find "$lock_dir" -mindepth 1 -maxdepth 1 -type f | wc -l)" -eq 1 ] || exit 1
  grep -qx 'pid=[0-9][0-9]*' "$lock_dir/pid" || exit 1
  lock_pid=$(sed -n 's/^pid=//p' "$lock_dir/pid" | sed -n '1p')
  case $lock_pid in *[!0-9]*|'') exit 1;; esac
  if kill -0 "$lock_pid" 2>/dev/null; then exit 1; fi
  if [ -e "$lock" ] || [ -L "$lock" ]; then
   [ -f "$lock" ] && [ ! -L "$lock" ] || exit 1
  fi
  rm -f "$lock_dir/pid" "$lock" || exit 1
  rmdir "$lock_dir" || exit 1
  (umask 077 && mkdir "$lock_dir") || exit 1
 fi
 (umask 077 && set -C && : >"$lock") || { rmdir "$lock_dir" 2>/dev/null || :; exit 1; }
 [ -f "$lock" ] && [ ! -L "$lock" ] || { rm -f "$lock"; rmdir "$lock_dir" 2>/dev/null || :; exit 1; }
 (umask 077 && set -C && printf 'pid=%s\n' "$$" >"$lock_dir/pid") || { rm -f "$lock"; rmdir "$lock_dir" 2>/dev/null || :; exit 1; }
 chmod 600 "$lock" "$lock_dir/pid" || { rm -f "$lock_dir/pid" "$lock"; rmdir "$lock_dir" 2>/dev/null || :; exit 1; }
 lock_owned=1
 trap 'release_lock' 0
 trap 'lock_signal' HUP INT TERM
}
expected_incoming_hash() {
 case $1 in
  login.sh) printf '%s\n' '6ceef1565b393e692216f8c789d52a5fe533df35f1db243eb90527c61d95b380' ;;
  check_status.sh) printf '%s\n' '24ae7e4190701786f39111e7a15210e8d3fa52fd1d25157806e89035bf5a590e' ;;
  logout.sh) printf '%s\n' '176e170723d8eef5fcc90cf160c50239c57213ff2c55e6b5a44a677f5b0ab5ca' ;;
  login_huxi.sh) printf '%s\n' '6ceef1565b393e692216f8c789d52a5fe533df35f1db243eb90527c61d95b380' ;;
  login_A.sh) printf '%s\n' '2c8551c7b2e8af6c7f791640bbb1718ee97abf28245fa695637a41988e8eef94' ;;
  *) exit 1 ;;
 esac
}
verify_incoming_actions() {
 for incoming in login.sh check_status.sh logout.sh login_huxi.sh login_A.sh; do
  incoming_path=$(p "/etc/multilogin/$incoming")
  [ -f "$incoming_path" ] && [ ! -L "$incoming_path" ] || exit 1
  [ "$(sha256 "$incoming_path")" = "$(expected_incoming_hash "$incoming")" ] || exit 1
 done
}
safe_tree() {
 [ -d "$1" ] && [ ! -L "$1" ] || return 1
 find "$1" -type l -print -quit | grep -q . && return 1
 find "$1" \( ! -type d ! -type f \) -print -quit | grep -q . && return 1
 return 0
}
cleanup_file_temp() {
 [ -n "${1:-}" ] || return 0
 rm -f "$1" 2>/dev/null || :
}
cleanup_directory_temp() {
 [ -n "${1:-}" ] || return 0
 rm -rf "$1" 2>/dev/null || :
}
cleanup_pending_temps() {
 cleanup_file_temp "${config_tmp:-}"
 cleanup_directory_temp "${archive_stage:-}"
 cleanup_file_temp "${manifest_tmp:-}"
}
restore_config() {
 config=$(p /etc/config/multilogin); config_dir=${config%/*}; config_tmp=''
 [ -d "$config_dir" ] && [ ! -L "$config_dir" ] || exit 1
 config_tmp=$(umask 077 && mktemp "$config_dir/.multilogin-v3-downgrade.XXXXXX") || exit 1
 if ! cp "$state/multilogin" "$config_tmp"; then cleanup_file_temp "$config_tmp"; exit 1; fi
 if ! chmod "$config_mode" "$config_tmp"; then cleanup_file_temp "$config_tmp"; exit 1; fi
 if ! mv -f "$config_tmp" "$config"; then cleanup_file_temp "$config_tmp"; exit 1; fi
 config_tmp=''
}
archive_is_valid() {
 [ -d "$archive" ] && [ ! -L "$archive" ] || return 1
 safe_tree "$archive" || return 1
 [ -f "$archive/cqu-portal.sh" ] && [ ! -L "$archive/cqu-portal.sh" ] || return 1
 [ "$(sha256 "$archive/cqu-portal.sh")" = "$active_hash" ] || return 1
 if [ -n "$saved_state" ]; then
  [ -d "$archive/script-state" ] && [ ! -L "$archive/script-state" ] || return 1
  safe_tree "$archive/script-state" || return 1
  [ "$(find "$archive" -mindepth 1 -maxdepth 1 | wc -l)" -eq 2 ] || return 1
 else
  [ ! -e "$archive/script-state" ] && [ ! -L "$archive/script-state" ] || return 1
  [ "$(find "$archive" -mindepth 1 -maxdepth 1 | wc -l)" -eq 1 ] || return 1
 fi
 return 0
}
build_archive() {
 archive_stage=$(umask 077 && mktemp -d "$state/.archive.XXXXXX") || exit 1
 if ! cp "$state/cqu-portal.sh" "$archive_stage/cqu-portal.sh"; then cleanup_directory_temp "$archive_stage"; exit 1; fi
 if [ -n "$saved_state" ]; then
  saved_state_path="${root%/}$saved_state"
  if ! safe_tree "$saved_state_path"; then cleanup_directory_temp "$archive_stage"; exit 1; fi
  if ! mkdir "$archive_stage/script-state"; then cleanup_directory_temp "$archive_stage"; exit 1; fi
  if ! cp -Rp "$saved_state_path/." "$archive_stage/script-state"; then cleanup_directory_temp "$archive_stage"; exit 1; fi
 fi
 if ! chmod -R go-rwx "$archive_stage"; then cleanup_directory_temp "$archive_stage"; exit 1; fi
 if ! mv "$archive_stage" "$archive"; then cleanup_directory_temp "$archive_stage"; exit 1; fi
 archive_stage=''
}
commit_manifest() {
 manifest_tmp=$(umask 077 && mktemp "$state/.manifest.XXXXXX") || exit 1
 if ! sed 's/^state=.*/state=complete/' "$manifest" >"$manifest_tmp"; then cleanup_file_temp "$manifest_tmp"; exit 1; fi
 if ! chmod 600 "$manifest_tmp"; then cleanup_file_temp "$manifest_tmp"; exit 1; fi
 if ! mv -f "$manifest_tmp" "$manifest"; then cleanup_file_temp "$manifest_tmp"; exit 1; fi
 manifest_tmp=''
}
service_action() {
 action=$1
 case $action in enable|disable|start|stop) ;; *) exit 1;; esac
 if [ -z "${IPKG_INSTROOT:-}" ] && [ "$root" = / ]; then
 /etc/init.d/multilogin "$action"
 fi
}
acquire_lock
[ -f "$finalizer" ] && [ ! -L "$finalizer" ] || exit 1
[ -f "$manifest" ] && [ ! -L "$manifest" ] || exit 1
grep -qx 'target=2.2.0-4' "$manifest" || exit 1
grep -qx 'source=fb272e8285c65415dea8a9a359a4204b94be06a0' "$manifest" || exit 1
version=$(sed -n 's/^Version: //p' "$(p /usr/lib/opkg/info/luci-app-multilogin.control)" 2>/dev/null | sed -n '1p')
[ "$version" = 2.2.0-4 ] || exit 1
[ -f "$state/multilogin" ] && [ ! -L "$state/multilogin" ] || exit 1
[ -f "$state/cqu-portal.sh" ] && [ ! -L "$state/cqu-portal.sh" ] || exit 1
generation=$(sed -n 's/^generation=//p' "$manifest" | sed -n '1p')
config_hash=$(sed -n 's/^config_sha256=//p' "$manifest" | sed -n '1p'); config_mode=$(sed -n 's/^config_mode=//p' "$manifest" | sed -n '1p')
active_hash=$(sed -n 's/^active_sha256=//p' "$manifest" | sed -n '1p'); active_mode=$(sed -n 's/^active_mode=//p' "$manifest" | sed -n '1p')
saved_state=$(sed -n 's/^script_state=//p' "$manifest" | sed -n '1p')
case $generation:$config_hash:$active_hash:$config_mode:$active_mode in *[!A-Za-z0-9_.:-]*) exit 1;; esac
[ -n "$generation" ] && [ -n "$config_hash" ] && [ -n "$active_hash" ] && [ -n "$config_mode" ] && [ -n "$active_mode" ] || exit 1
[ -z "$saved_state" ] || { case $saved_state in /etc/multilogin/.migration-v3/downgrade-state/script-state.*) [ -d "${root%/}$saved_state" ];; *) exit 1;; esac; }
[ "$(sha256 "$state/multilogin")" = "$config_hash" ] || exit 1
[ "$(sha256 "$state/cqu-portal.sh")" = "$active_hash" ] || exit 1
[ "$(stat -c %a "$state/multilogin")" = "$config_mode" ] || exit 1
[ "$(stat -c %a "$state/cqu-portal.sh")" = "$active_mode" ] || exit 1
[ -f "$state/service.before" ] && [ ! -L "$state/service.before" ] || exit 1
enabled=$(sed -n 's/^enabled=//p' "$state/service.before" | sed -n '1p'); running=$(sed -n 's/^running=//p' "$state/service.before" | sed -n '1p')
case $enabled:$running in 0:0|0:1|1:0|1:1) ;; *) exit 1;; esac
verify_incoming_actions
case $(sed -n 's/^state=//p' "$manifest" | sed -n '1p') in
complete) rm -f "$finalizer"; exit 0 ;;
prepared) ;;
*) exit 1 ;;
esac
archive=$state/v3-archive.$generation
if [ -e "$archive" ] || [ -L "$archive" ]; then
 archive_is_valid || exit 1
else
 build_archive
 archive_is_valid || exit 1
fi
# Restore config before destructive runtime cleanup.  If it cannot complete,
# retain the full v3 runtime and state for a safe rerun.
restore_config
live_state=$(p /etc/multilogin/.script-state)
if [ -e "$live_state" ] || [ -L "$live_state" ]; then
 [ -d "$live_state" ] && [ ! -L "$live_state" ] || exit 1
 find "$live_state" -type l -print -quit | grep -q . && exit 1
 rm -rf "$live_state"
fi
rm -f "$(p /etc/multilogin/cqu-portal.sh)"
for legacy in login.sh check_status.sh logout.sh login_huxi.sh login_A.sh; do
 [ -e "$(p /etc/multilogin/$legacy)" ] && chmod 755 "$(p /etc/multilogin/$legacy)"
done
if [ -z "${IPKG_INSTROOT:-}" ] && [ "$root" = / ]; then
 if [ "$enabled" = 1 ]; then service_action enable; else service_action disable; fi
 if [ "$running" = 1 ]; then service_action start; else service_action stop; fi
fi
commit_manifest
rm -f "$finalizer"
ML_FINALIZER_EOF
}

ml_prerm() {
	if ml_is_upgrade "$@"; then
		case ${2:-${PKG_NEW_VERSION:-}} in
		2.2.0-4)
			ml_prepare_downgrade "$@" || return 1
			if ml_service_actions_enabled; then ml_service_action stop || return 1; fi
			return 0
			;;
		0.* | 1.* | 2.*)
			ml_die 'unsupported downgrade target'
			return 1
			;;
		*) return 0 ;;
		esac
	fi
	ml_init || return 1
	if ml_service_actions_enabled; then
		ml_service_action stop 2>/dev/null || :
		ml_service_action disable 2>/dev/null || :
	fi
}

ml_postrm() {
	ml_init || return 1
	if ml_is_upgrade "$@"; then return 0; fi
	if ml_service_actions_enabled; then
		ml_service_action stop 2>/dev/null || :
		ml_service_action disable 2>/dev/null || :
	fi
}
