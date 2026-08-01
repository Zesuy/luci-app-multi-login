#!/bin/sh

set -eu

TEST_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
REPOSITORY=$(cd -- "$TEST_DIR/.." && pwd)
BASELINE_REF=fb272e8285c65415dea8a9a359a4204b94be06a0
TEMP_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/multilogin-tests.XXXXXX")
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

check_shell_syntax() {
	LIST=$TEMP_ROOT/shell-files
	find "$REPOSITORY/etc" "$REPOSITORY/tools" "$REPOSITORY/root/usr/lib" "$REPOSITORY/root/usr/libexec" "$TEST_DIR" -type f -print | LC_ALL=C sort >"$LIST"
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
	find "$REPOSITORY/etc" "$REPOSITORY/tools" "$REPOSITORY/root/usr/lib" "$REPOSITORY/root/usr/libexec" "$TEST_DIR" -type f -print | LC_ALL=C sort >"$LIST"
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
negative_tests
node "$TEST_DIR/test-phase4-logic.mjs"
pass 'Phase 4 static and pure wrapper logic suite'
node "$TEST_DIR/test-phase5-logic.mjs"
pass 'Phase 5 static and pure policy logic suite'
node "$TEST_DIR/test-phase6-static.mjs"
pass 'Phase 6 static and extracted pure UI logic suite'
node "$TEST_DIR/test-phase7-logic.mjs"
pass 'Phase 7 static and pure product/permission logic suite'
node "$TEST_DIR/test-phase8-release.mjs"
pass 'Phase 8 static, release-matrix, and read-only artifact suite'

printf '\n%d checks passed; %d optional tooling checks skipped.\n' "$PASS_COUNT" "$SKIP_COUNT"
