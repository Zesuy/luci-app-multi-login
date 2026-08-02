# MultiLogin v3 Workspace Handout

## Purpose

This handout is the compact restart context for future Codex tasks in this workspace. The project-specific rules are in `AGENTS.md`; the Luna-first workflow configuration is in `.codex/`.

## Repository state

- Repository: `luci-app-multi-login`
- Current branch: `codex/fix-release-checksum`
- Latest committed baseline: `78c4346 Polish MultiLogin LuCI visual layer`; the current r18 UI-safety follow-up is the working-tree release candidate.
- Target product: MultiLogin v3, `v3.0.0-rc.1`
- Current package revision: `r18`
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

LuCI 23.05 `E()` serializes non-null attributes with `setAttribute()`. Passing `disabled: false` therefore created `disabled="false"`, disabling every button. The five MultiLogin views now omit the attribute when idle and emit it only for busy/recovery states. The backend now enumerates legacy anonymous UCI sections, preserves named `cfg_*` sections, creates new account/instance sections with stable names, names referenced anonymous instances before rewriting account links, and rolls back failed normalization transactions. Package revision r18 adds a task-oriented four-destination information architecture and progressive page flows without changing those persistence and safety boundaries.

The r10 audit also makes the controller enumerate generated UCI instance names with `uci -X`, maps local portal failures to the valid `internal_error/internal` envelope, and updates the release/changelog/device-acceptance candidate identity to r10. QEMU then exposed three runtime blockers: r10's command substitution stripped the newline used by `ml_valid_text()`; after r11 fixed that, BusyBox awk rejected the bare `!~` pattern used for section identity; after r12 fixed that, deleting an absent blank `v6face` option returned nonzero and rolled back instance creation. r13 made absent deletion idempotent; Sol rejected its unconditional ignore and then r15's unanchored match; r16 now anchors exact section option lines and fails closed on all real errors. Package revision r18 adds the task-oriented navigation and page flows on top of the shared visual layer without changing the fixed RPC/UCI/service/portal boundaries.

## Validation evidence

The r10 bounded local runner passed 16 checks; four optional tools were unavailable locally. QEMU reproduced account rejection on r10, then instance rollback on r11 and r12; Sol's independent review returned `BLOCK` on the first validator defect and identified the subsequent fail-open/substring defects. The r18 source now passes executable Phase 7 `16/16`, Phase 6 `8/8`, full runner `16` with four optional tooling skips, controller `19/19`, portal `9/9`, version matrix, and read-only IPK inspection. The final clean 24.10.8 IPK is `luci-app-multilogin_3.0.0-rc.1-r18_all.ipk`, SHA-256 `35aed4d49e055895dbb5186635ca7f7d0478ca0e704b4bd6f804d590cb34291e`. It was force-reinstalled in disposable QEMU; final screenshots and evidence are in `/tmp/multilogin-qemu-r10/screenshots/`, including desktop/mobile maintenance navigation and an offline recovery-confirmation fixture. QEMU readback shows `account_1` / `offline-ui-check`, auto-login disabled, no login task, and no password or Portal request. Sol's independent r18 follow-up review returned `PASS`; no P0/P1 remains.

## Next task checklist

1. Read `AGENTS.md` and `dev/plan/multilogin-v3.md` before v3 edits.
2. Keep local `node_modules/`, `package.json`, and `package-lock.json` ignored and out of commits; `.gitignore` now records these rules.
3. Choose `LUNA_LOCAL` unless there are independent disjoint packets or a genuine high-impact decision.
4. Run only the bounded validation appropriate to the changed files.
5. Record accepted changes, evidence, decisions, risks, and deferred manual items in the execution plan.
6. For a fresh session, use the retained r18 artifact/checksum and repeat only the explicitly authorized Phase 9 device cells. The disposable QEMU smoke and r16 behavior evidence remain valid; keep real-device and Portal actions separately authorized.
7. Do not push, release, install packages, mutate a real device, or perform portal login/logout without explicit authorization.
