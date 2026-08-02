# MultiLogin v3 Workspace Handout

## Purpose

This handout is the compact restart context for future Codex tasks in this workspace. The project-specific rules are in `AGENTS.md`; the Luna-first workflow configuration is in `.codex/`.

## Repository state

- Repository: `luci-app-multi-login`
- Current branch: `codex/fix-release-checksum`
- Latest committed fix: `8d83a52 Fix r10 controller, portal, and release checks`
- Target product: MultiLogin v3, `v3.0.0-rc.1`
- Current package revision: `r10`
- Execution plan: `dev/plan/multilogin-v3.md`
- Phase status: Phase 9 remains blocked pending explicit real-device/portal authorization.

## Installed workflow

- `.codex/config.toml`: Luna Max primary, Luna Max default workers, six-worker limit.
- `.codex/agents/luna-worker.toml`: bounded implementation/test/exploration worker.
- `.codex/agents/sol-advisor.toml`: read-only, on-demand Sol advisor for high-impact decisions.
- `AGENTS.md`: project rules plus the Luna-first routing overlay.

The source workflow was cloned to a temporary directory from `BruceLanLan/sol-luna-engineering-workflow`; it is a configuration bundle, not a Codex skill and has no `SKILL.md`.

## Product facts

- `login_control.bash` remains package-managed and owns scheduling/backoff.
- Only `/etc/multilogin/cqu-portal.sh` may be updated from the fixed GitHub Raw URL.
- LuCI uses fixed `multilogin` RPC methods and must not access arbitrary files, URLs, commands, or UCI directly.
- Passwords must never appear in argv, logs, RPC responses, fixtures, diagnostics, or browser-visible data.
- OpenWrt/package/service/network/portal integration is manual Phase 9 work; unattended checks stay compile/static/pure-logic.

## Latest fixes

LuCI 23.05 `E()` serializes non-null attributes with `setAttribute()`. Passing `disabled: false` therefore created `disabled="false"`, disabling every button. The five MultiLogin views now omit the attribute when idle and emit it only for busy/recovery states. The backend now enumerates legacy anonymous UCI sections, preserves named `cfg_*` sections, creates new account/instance sections with stable names, names referenced anonymous instances before rewriting account links, and rolls back failed normalization transactions. The package revision is r10.

The r10 audit also makes the controller enumerate generated UCI instance names with `uci -X`, maps local portal failures to the valid `internal_error/internal` envelope, and updates the release/changelog/device-acceptance candidate identity to r10.

## Validation evidence

The bounded local runner passed 16 checks; four optional tools were unavailable locally. Focused suites passed: controller `19/19`, portal `9/9`, Phase 7 `15/15`, and Phase 8 `7/7`; the r10 version matrix and `git diff --check` also passed. Sol's second whole-repository product/code review returned `PASS`. A normal SDK build stopped before this package at the SDK's unconfigured kernel directory while compiling `ipset`; an `IGNORE_ERRORS=1` staging/package pass produced an r10 IPK, and read-only artifact inspection passed. Clean matrix compilation and device installation of r10 are still pending.

## Next task checklist

1. Read `AGENTS.md` and `dev/plan/multilogin-v3.md` before v3 edits.
2. Keep local `node_modules/`, `package.json`, and `package-lock.json` ignored and out of commits; `.gitignore` now records these rules.
3. Choose `LUNA_LOCAL` unless there are independent disjoint packets or a genuine high-impact decision.
4. Run only the bounded validation appropriate to the changed files.
5. Record accepted changes, evidence, decisions, risks, and deferred manual items in the execution plan.
6. Rebuild/install r10 only with explicit device authorization; verify account add/readback, edit/reference stability, and delete-conflict behavior before claiming persistence.
7. Do not push, release, install packages, mutate a real device, or perform portal login/logout without explicit authorization.
