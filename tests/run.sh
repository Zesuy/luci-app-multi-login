#!/bin/sh

set -eu

TEST_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
REPOSITORY=$(cd -- "$TEST_DIR/.." && pwd)
ORIGINAL_PATH=$PATH
BASELINE_REF=fb272e8285c65415dea8a9a359a4204b94be06a0
TEMP_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/multilogin-tests.XXXXXX")
MOCK_BIN=$TEMP_ROOT/mock-bin
MOCK_STATE=$TEMP_ROOT/mock-state
PASS_COUNT=0
SKIP_COUNT=0

cleanup() {
	rm -rf "$TEMP_ROOT"
}
trap cleanup EXIT HUP INT TERM

pass() {
	PASS_COUNT=$((PASS_COUNT + 1))
	printf 'PASS  %s\n' "$1"
}

skip() {
	SKIP_COUNT=$((SKIP_COUNT + 1))
	printf 'SKIP  %s\n' "$1"
}

fail() {
	printf 'FAIL  %s\n' "$1" >&2
	exit 1
}

require_command() {
	command -v "$1" >/dev/null 2>&1 || fail "required command is unavailable: $1"
}

tooling_required() {
	[ "${MULTILOGIN_REQUIRE_TOOLING:-0}" = 1 ] || {
		[ -n "${CI:-}" ] && [ "${CI:-}" != 0 ] && [ "${CI:-}" != false ]
	}
}

expect_failure() {
	NAME=$1
	shift
	OUTPUT=$TEMP_ROOT/expected-failure.out
	if "$@" >"$OUTPUT" 2>&1; then
		fail "$NAME unexpectedly succeeded"
	fi
	rm -f "$OUTPUT"
	pass "$NAME rejects the intentional bad case"
}

expect_status() {
	NAME=$1
	EXPECTED_STATUS=$2
	shift 2
	OUTPUT=$TEMP_ROOT/expected-status.out
	if "$@" >"$OUTPUT" 2>&1; then
		ACTUAL_STATUS=0
	else
		ACTUAL_STATUS=$?
	fi
	rm -f "$OUTPUT"
	[ "$ACTUAL_STATUS" -eq "$EXPECTED_STATUS" ] || fail "$NAME returned $ACTUAL_STATUS, expected $EXPECTED_STATUS"
	pass "$NAME rejects the intentional bad case"
}

setup_mocks() {
	mkdir -p "$MOCK_BIN" "$MOCK_STATE/allow" "$MOCK_STATE/responses"
	for COMMAND in \
		uci ubus jsonfilter ifstatus ip mwan3 curl logger service multilogin-init \
		procd procd_open_instance procd_set_param procd_close_instance \
		procd_add_reload_trigger df stat date od sleep kill multilogin-signal; do
		ln -s "$TEST_DIR/mocks/command" "$MOCK_BIN/$COMMAND"
	done
	MULTILOGIN_MOCK_STATE=$MOCK_STATE
	MULTILOGIN_MOCK_CAPTURE_HELPER=$TEST_DIR/mocks/capture-stdin.mjs
	export MULTILOGIN_MOCK_STATE MULTILOGIN_MOCK_CAPTURE_HELPER
	PATH=$MOCK_BIN:$ORIGINAL_PATH
	export PATH
}

allow_mock() {
	COMMAND=$1
	STATUS=${2:-0}
	mkdir -p "$MOCK_STATE/responses/$COMMAND/default"
	: >"$MOCK_STATE/allow/$COMMAND"
	printf '%s\n' "$STATUS" >"$MOCK_STATE/responses/$COMMAND/default/status"
}

check_shell_syntax() {
	LIST=$TEMP_ROOT/shell-files
	find "$REPOSITORY/etc" "$REPOSITORY/tools" "$REPOSITORY/root/usr/libexec" "$TEST_DIR" -type f -print | LC_ALL=C sort >"$LIST"
	while IFS= read -r FILE; do
		read -r FIRST_LINE <"$FILE" || FIRST_LINE=
		case $FIRST_LINE in
		'#!'*bash*) bash -n "$FILE" ;;
		'#!'*'/sh'*) sh -n "$FILE" ;;
		esac
	done <"$LIST"
	pass 'shell and Bash syntax'
}

check_busybox_ash() {
	if ! command -v busybox >/dev/null 2>&1; then
		if tooling_required; then
			fail 'BusyBox ash is mandatory under CI/tooling-required mode'
		fi
		skip 'BusyBox ash unavailable locally'
		return
	fi

	LIST=$TEMP_ROOT/posix-shell-files
	find "$REPOSITORY/etc" "$REPOSITORY/tools" "$REPOSITORY/root/usr/libexec" "$TEST_DIR" -type f -print | LC_ALL=C sort >"$LIST"
	while IFS= read -r FILE; do
		read -r FIRST_LINE <"$FILE" || FIRST_LINE=
		case $FIRST_LINE in
		'#!'*'/sh'*) busybox ash -n "$FILE" ;;
		esac
	done <"$LIST"
	pass 'BusyBox ash syntax'
}

v3_shell_file_list() {
	(
		cd "$REPOSITORY"
		git diff --name-only "$BASELINE_REF" --
		git ls-files --others --exclude-standard
	) | LC_ALL=C sort -u | while IFS= read -r RELATIVE; do
		FILE=$REPOSITORY/$RELATIVE
		[ -f "$FILE" ] || continue
		case $RELATIVE in
		*.sh | *.bash)
			printf '%s\n' "$FILE"
			continue
			;;
		esac
		read -r FIRST_LINE <"$FILE" || FIRST_LINE=
		case $FIRST_LINE in
		'#!'*'/sh'* | '#!'*bash*) printf '%s\n' "$FILE" ;;
		esac
	done
}

check_lint_scope() {
	LIST=$TEMP_ROOT/lint-scope
	v3_shell_file_list >"$LIST"
	for REQUIRED in tools/v3-baseline.sh tests/run.sh tests/mocks/command; do
		grep -Fxq "$REPOSITORY/$REQUIRED" "$LIST" || fail "changed shell file missing from lint scope: $REQUIRED"
	done
	pass 'baseline-aware changed shell lint scope'
}

check_shellcheck() {
	if ! command -v shellcheck >/dev/null 2>&1; then
		if tooling_required; then
			fail 'ShellCheck is mandatory under CI/tooling-required mode'
		fi
		skip 'ShellCheck unavailable locally'
		return
	fi
	v3_shell_file_list | while IFS= read -r FILE; do
		case $FILE in
		"$REPOSITORY/tools/v3-baseline.sh")
			# The baseline generator intentionally prints literal Markdown backticks.
			shellcheck -e SC2016 "$FILE"
			;;
		*) shellcheck "$FILE" ;;
		esac
	done
	pass 'ShellCheck for test/v3 shell files'
}

check_shfmt() {
	if ! command -v shfmt >/dev/null 2>&1; then
		if tooling_required; then
			fail 'shfmt is mandatory under CI/tooling-required mode'
		fi
		skip 'shfmt unavailable locally'
		return
	fi
	v3_shell_file_list | while IFS= read -r FILE; do shfmt -d "$FILE"; done
	pass 'shfmt for test/v3 shell files'
}

check_javascript() {
	find "$REPOSITORY/htdocs" "$TEST_DIR" -type f \( -name '*.js' -o -name '*.mjs' \) -print | LC_ALL=C sort |
		while IFS= read -r FILE; do node --check "$FILE"; done
	pass 'Node JavaScript syntax'
}

check_baseline() {
	FIRST=$TEMP_ROOT/baseline-first
	SECOND=$TEMP_ROOT/baseline-second
	(
		cd "$REPOSITORY"
		sh tools/v3-baseline.sh >"$FIRST"
		sh tools/v3-baseline.sh >"$SECOND"
	)
	cmp "$FIRST" "$SECOND"
	cmp "$FIRST" "$REPOSITORY/docs/v3/baseline-v2.2.0-4.txt"
	pass 'deterministic Phase 0 baseline reproduction'
}

check_mock_capture() {
	allow_mock uci 0
	printf '1\n' >"$MOCK_STATE/responses/uci/default/stdout"
	SENTINEL="phase1-stdin-guard-$(printf 'fixture' | sha256sum | cut -c1-12)"
	EXPECTED_HASH=$(printf '%s' "$SENTINEL" | sha256sum | awk '{ print $1 }')
	MULTILOGIN_MOCK_SECRET_SHA256=$EXPECTED_HASH
	export MULTILOGIN_MOCK_SECRET_SHA256
	expect_status 'secret-bearing mock argv' 94 uci get "$SENTINEL"
	node "$TEST_DIR/check-safety.mjs" --root "$MOCK_STATE" --allowlist /dev/null --sentinel "$SENTINEL"
	RESULT=$(printf '%s' "$SENTINEL" | uci get multilogin.global.enabled)
	[ "$RESULT" = 1 ] || fail 'mock response was not returned'

	CALL=$MOCK_STATE/calls/uci/1
	EXPECTED_ARGV=$TEMP_ROOT/expected-argv.bin
	printf 'get\0multilogin.global.enabled\0' >"$EXPECTED_ARGV"
	cmp "$EXPECTED_ARGV" "$CALL/argv.bin"
	[ "$(cat "$CALL/stdin.length")" -eq "${#SENTINEL}" ] || fail 'mock stdin length is incorrect'
	[ "$(cat "$CALL/stdin.sha256")" = "$EXPECTED_HASH" ] || fail 'mock stdin hash is incorrect'
	node "$TEST_DIR/check-safety.mjs" --root "$CALL" --allowlist /dev/null --sentinel "$SENTINEL"
	pass 'PATH mock captures NUL argv and stdin metadata only'
}

negative_tests() {
	BAD_SHELL=$TEMP_ROOT/bad.sh
	printf '%s\n' '#!/bin/sh' 'if then' >"$BAD_SHELL"
	expect_failure 'bad shell syntax' sh -n "$BAD_SHELL"

	expect_failure 'malformed JSONP fixture' node "$TEST_DIR/check-fixtures.mjs" --require-valid "$TEST_DIR/fixtures/portal/malformed.jsonp"

	SENTINEL="phase1-leak-guard-$(printf 'negative' | sha256sum | cut -c1-12)"
	LEAK_ROOT=$TEMP_ROOT/leak-root
	mkdir -p "$LEAK_ROOT"
	printf '%s\n' "$SENTINEL" >"$LEAK_ROOT/output.log"
	expect_failure 'secret sentinel guard' node "$TEST_DIR/check-safety.mjs" --root "$LEAK_ROOT" --allowlist /dev/null --sentinel "$SENTINEL"

	UNSAFE_ROOT=$TEMP_ROOT/unsafe-root
	mkdir -p "$UNSAFE_ROOT"
	printf '%s\n' '#!/bin/sh' 'eval "fixture"' >"$UNSAFE_ROOT/new.sh"
	expect_failure 'new unsafe pattern' node "$TEST_DIR/check-safety.mjs" --root "$UNSAFE_ROOT" --allowlist /dev/null

	expect_status 'unexpected mock command' 97 logger 'must-not-run'

	: >"$MOCK_STATE/allow/curl"
	expect_status 'unscripted network mock' 96 curl 'https://invalid.example.test/'
}

require_command sh
require_command bash
require_command node
require_command git
require_command find
require_command cmp
require_command sha256sum
require_command awk
require_command sed

setup_mocks
check_shell_syntax
check_busybox_ash
check_lint_scope
check_shellcheck
check_shfmt
check_javascript
node "$TEST_DIR/check-json.mjs"
pass 'JSON, menu, and ACL structure'
node "$TEST_DIR/check-fixtures.mjs"
pass 'redacted JSONP fixtures and scenario coverage'
node "$TEST_DIR/check-safety.mjs" --sentinel "phase1-repository-guard-$(printf 'absent' | sha256sum | cut -c1-12)"
pass 'legacy unsafe-pattern allowlist and repository secret guard'
check_baseline
check_mock_capture
negative_tests

printf '\n%d checks passed; %d optional tooling checks skipped.\n' "$PASS_COUNT" "$SKIP_COUNT"
