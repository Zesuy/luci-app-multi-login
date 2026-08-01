#!/bin/sh
# Source-only Phase 7 policy predicates. Loading this file performs no I/O.
# shellcheck disable=SC3043

ml_config_token() {
	case ${1:-} in '' | [!A-Za-z_]* | *[!A-Za-z0-9_]*) return 1 ;; esac
	[ "${#1}" -le 64 ]
}

ml_config_iface() {
	case ${1:-} in '' | [!A-Za-z0-9]* | *[!A-Za-z0-9_.:-]*) return 1 ;; esac
	[ "${#1}" -le 15 ]
}

ml_config_uint_range() {
	local value minimum maximum
	value=${1:-}
	minimum=${2:-}
	maximum=${3:-}
	case $value in *[!0-9]* | '') return 1 ;; esac
	[ "$value" -ge "$minimum" ] 2>/dev/null && [ "$value" -le "$maximum" ] 2>/dev/null
}

ml_config_boolean() {
	[ "${1:-}" = 0 ] || [ "${1:-}" = 1 ]
}

ml_config_log_level() {
	case ${1:-} in debug | info | notice | warning | error) return 0 ;; *) return 1 ;; esac
}

ml_config_ua_type() {
	case ${1:-} in pc | mobile) return 0 ;; *) return 1 ;; esac
}

ml_config_action() {
	case ${1:-} in start | stop | restart | enable | disable) return 0 ;; *) return 1 ;; esac
}

ml_config_request_fields() {
	local method actual expected
	method=${1:-}
	actual=${2:-}
	case $method in
	get_overview | get_settings | list_accounts | list_instances | service_status | get_diagnostics | get_logs | clear_logs | list_auto | remove_auto | network_recover) expected='' ;;
	save_settings) expected='already_logged_delay check_interval enabled log_level max_retry_delay retry_interval' ;;
	save_account) expected='alias password section username' ;;
	delete_account | delete_instance | check_instance | test_instance | logout_instance) expected='section' ;;
	save_instance) expected='account alias enabled interface section ua_type v6face' ;;
	service_action) expected='action' ;;
	quick_setup) expected='base_iface count' ;;
	*)
		printf '%s\n' invalid_request
		return
		;;
	esac
	if [ "$actual" = "$expected" ]; then printf '%s\n' ok; else printf '%s\n' invalid_request; fi
}

ml_config_state_empty() {
	printf '%s' '{"schema":1,"generation":0,"base_iface":"","count":0,"firewall_zone":"","network_sections":[],"firewall_networks":[],"mwan3_sections":[],"mwan3_policy":"balanced","mwan3_members":[]}'
}

ml_config_state_json() {
	local generation base count n network firewall mwan members
	generation=$1
	base=$2
	count=$3
	if [ "$count" -eq 0 ] 2>/dev/null; then
		printf '%s' "{\"schema\":1,\"generation\":$generation,\"base_iface\":\"\",\"count\":0,\"firewall_zone\":\"\",\"network_sections\":[],\"firewall_networks\":[],\"mwan3_sections\":[],\"mwan3_policy\":\"balanced\",\"mwan3_members\":[]}"
		return
	fi
	network=''
	firewall=''
	mwan=''
	members=''
	for n in 1 10 2 3 4 5 6 7 8 9; do
		[ "$n" -le "$count" ] || continue
		[ -z "$network" ] || network="$network,"
		network="$network\"ml3_dev_$n\""
	done
	for n in 1 10 2 3 4 5 6 7 8 9; do
		[ "$n" -le "$count" ] || continue
		network="$network,\"ml3_if_$n\""
		[ -z "$firewall" ] || firewall="$firewall,"
		[ -z "$mwan" ] || mwan="$mwan,"
		firewall="$firewall\"ml3_if_$n\""
		mwan="$mwan\"ml3_if_$n\""
	done
	for n in 1 10 2 3 4 5 6 7 8 9; do
		[ "$n" -le "$count" ] || continue
		mwan="$mwan,\"ml3_member_$n\""
		[ -z "$members" ] || members="$members,"
		members="$members\"ml3_member_$n\""
	done
	printf '%s' "{\"schema\":1,\"generation\":$generation,\"base_iface\":\"$base\",\"count\":$count,\"firewall_zone\":\"ml3_zone\",\"network_sections\":[$network],\"firewall_networks\":[$firewall],\"mwan3_sections\":[$mwan],\"mwan3_policy\":\"balanced\",\"mwan3_members\":[$members]}"
}

# Return the only permitted journal recovery decision.  Inputs are canonical
# serialized state JSON strings after the caller has checked their schemas.
ml_config_journal_decision() {
	local journal_state durable before after
	journal_state=${1:-}
	durable=${2:-}
	before=${3:-}
	after=${4:-}
	if [ -z "$durable" ] || [ -z "$before" ] || [ -z "$after" ]; then
		printf '%s\n' manual_recovery
		return
	fi
	[ "$durable" = "$after" ] && {
		printf '%s\n' cleanup_committed
		return
	}
	if [ "$journal_state" = rollback_required ] && [ "$durable" = "$before" ]; then
		printf '%s\n' restore_before
		return
	fi
	case $journal_state in prepared | network_committed | firewall_committed | mwan3_committed | services_reloaded)
		[ "$durable" = "$before" ] && {
			printf '%s\n' finish_after
			return
		}
		;;
	esac
	printf '%s\n' manual_recovery
}
