# MultiLogin v3 Workspace Handout

## Purpose

This handout is the compact restart context for future Codex tasks in this workspace. The tracked project-specific workflow rules are in `AGENTS.md`; repository-local `.codex/` settings are ignored and remain developer/session state.

## Repository state

- Repository: `luci-app-multi-login`
- Current branch: `codex/fix-release-checksum`
- Latest accepted product baseline: `a35fca7 Converge r19 dashboard and managed script UI`; r23 is the current branch candidate and remains blocked from RC acceptance.
- Target product: MultiLogin v3, `v3.0.0-rc.1`
- Current package revision: `r23`
- Execution plan: `dev/plan/multilogin-v3.md`
- Phase status: Phase 9 remains blocked pending explicit real-device/portal authorization.

## Installed workflow

- `AGENTS.md`: tracked project rules plus the Luna-first routing overlay.
- `.codex/`: ignored local configuration. It must not be used as durable project state or committed to this repository.

## Product facts

- `login_control.bash` remains package-managed and owns scheduling/backoff.
- Only `/etc/multilogin/cqu-portal.sh` may be updated from the fixed GitHub Raw URL.
- LuCI uses fixed `multilogin` RPC methods and must not access arbitrary files, URLs, commands, or UCI directly.
- Passwords must never appear in argv, logs, RPC responses, fixtures, diagnostics, or browser-visible data.
- OpenWrt/package/service/network/portal integration is manual Phase 9 work; unattended checks stay compile/static/pure-logic.

## Latest fixes

Package revision r23 fixes the automation-settings save bug: clicking 保存自动
登录设置 no longer reads a form that was already redrawn into its old state.
The RPC starts before the busy-state redraw, so the checked box is preserved and
`multilogin.global.enabled=1` persists.

Package revision r22 wraps the login-task edit/status and login/logout/delete
action groups in one row-level flex container, so desktop tables render the
five actions in a single line while retaining the visual divider and the
narrow-screen wrap/stack behavior. The QEMU smoke/evidence harness was also
hardened against LuCI core RPC noise, pre-login session errors, the legacy
scripts route, and slow TCG first-loads.

Package revision r21 removes the non-portable local-input dependencies exposed
by the first r20 router action test. The rpcd password remains a single
stdin-only line, but the portal script no longer writes it to a second
temporary file or requires `dd`, `od`, and `wc` to read it. Validated IPv4/IPv6
Base64 uses the already-required `awk` and no longer assumes standalone
`base64`, OpenSSL, or an optional BusyBox applet. r20 artifacts are rejected as
device candidates for this action-path defect.

Package revision r20 fixes the P0 manual instance-action chain: the rpcd action handler now validates and removes injected `ubus_rpc_session` metadata, so status/login/logout reach the fixed portal child; passwords remain stdin-only, structured status/outcome/exit results remain visible per task, and actual child invocations write only an allowlisted root-only diagnostic. The instance editor uses preserving IPv4/IPv6 interface selectors, including a saved value that is temporarily absent from the current network list. Custom script management is reduced to editing, saving, saving-and-enabling, reloading, and discarding. A new fixed write-only `script_create_draft` RPC can copy only a generation/hash-matched Managed active script into a verified mode-0600 isolated draft; it never returns active source directly and rejects Custom/unknown active modes or an existing draft.

Portal `rc.4` follows the separately captured PC `0/1/1` and Mobile `1/2/2`
page requests and recognizes the observed `online_mac`/`online_ip` status fields.
This proves per-mode request construction and classification only. PC/Mobile
simultaneous coexistence is **not completed**: current device observations still
show one mode displacing the other, and no request-side `phone_flag` exists to
force coexistence. Do not describe this as fixed until `PORTAL-03A` has real
concurrent-session evidence.

LuCI 23.05 `E()` serializes non-null attributes with `setAttribute()`. Passing `disabled: false` therefore created `disabled="false"`, disabling every button. The five MultiLogin views now omit the attribute when idle and emit it only for busy/recovery states. The backend now enumerates legacy anonymous UCI sections, preserves named `cfg_*` sections, creates new account/instance sections with stable names, names referenced anonymous instances before rewriting account links, and rolls back failed normalization transactions. Package revision r19 keeps the task-oriented four-destination information architecture while reducing the dashboard and managed-update surfaces to the decisions users need, without changing persistence or safety boundaries.

The r10 audit also makes the controller enumerate generated UCI instance names with `uci -X`, maps local portal failures to the valid `internal_error/internal` envelope, and updates the release/changelog/device-acceptance candidate identity to r10. QEMU then exposed three runtime blockers: r10's command substitution stripped the newline used by `ml_valid_text()`; after r11 fixed that, BusyBox awk rejected the bare `!~` pattern used for section identity; after r12 fixed that, deleting an absent blank `v6face` option returned nonzero and rolled back instance creation. r13 made absent deletion idempotent; Sol rejected its unconditional ignore and then r15's unanchored match; r16 now anchors exact section option lines and fails closed on all real errors. Package revision r19 adds the task-oriented navigation and page flows on top of the shared visual layer, removes non-essential dashboard/update detail, and filters optional script-card children for LuCI 23.05 without changing the fixed RPC/UCI/service/portal boundaries.

## Validation evidence

The r21 portal gate passes `9/9`, RPC actions `24/24`, release checks `7/7`,
the bounded runner 16 groups with four optional-tool skips, and independent
Terra review. Official SDK builds and read-only inspection pass: 24.10.8 IPK
`/tmp/multilogin-sdk-24.10.8-clean.YGS4aW/bin/packages/x86_64/base/luci-app-multilogin_3.0.0-rc.1-r21_all.ipk`,
SHA-256 `cd96c2c02a75ce9536df17f7b4bf2e601c0bcef8648a21c643c895bf4c3f4d0c`;
25.12.5 APK
`/tmp/multilogin-sdk-25.12.5-clean.XVEs9z/bin/packages/x86_64/base/luci-app-multilogin-3.0.0_rc1-r21.apk`,
SHA-256 `31bcc87e8d3080362cd868b6bb23b32c04e82b09196f4f8a4f49d05f5ffc60e0`.
The packaged factory portal script is byte-identical to source. r20 checksums
are retained only as historical evidence and must not be installed.

Package revision r23 is the current disposable-QEMU candidate:
`luci-app-multilogin_3.0.0-rc.1-r23_all.ipk`, SHA-256
`6d8847cab2167dd25a2268718946fd83666b1418c5cec4d21c0a671621b36113`. A fresh
OpenWrt 24.10.8 QEMU installed it; the Playwright save check sent `enabled:"1"`,
kept the checkbox checked, and `uci get multilogin.global.enabled` returned
`1`; Overview/Scripts smoke PASS; 12 screenshots plus
`evidence.json`/`sha256sums.txt` are under
`/tmp/multilogin-savecheck.WgQyQP/evidence/`. The earlier r22 layout
screenshots remain under `/tmp/multilogin-qemu.11xkqp/evidence/`. Release
artifact inspection remains blocked by the preserved workspace `cqu-portal.sh`
version `3.0.0-rc.4` versus package/tag `3.0.0-rc.1`.

The r10 bounded local runner passed 16 checks; four optional tools were unavailable locally. QEMU reproduced account rejection on r10, then instance rollback on r11 and r12; Sol's independent review returned `BLOCK` on the first validator defect and identified the subsequent fail-open/substring defects. The r19 source passes executable Phase 7 `16/16`, Phase 6 `8/8`, full runner `16` with four optional tooling skips, controller `19/19`, portal `9/9`, version matrix, and read-only IPK inspection. The rebuilt 24.10.8 IPK is `luci-app-multilogin_3.0.0-rc.1-r19_all.ipk`, SHA-256 `eff0fdf02ccb13b70387798c149100235f5f7fa0c0467be41305f69ab8fa0281`. It was force-reinstalled in disposable QEMU; r19 screenshots and evidence are in `/tmp/multilogin-qemu-r10/screenshots/`, including desktop/mobile dashboard/script views, the clear `r19-service-enable-confirm-390.png` confirmation capture, all five service actions, cancellation with zero `service_action`, and cancellation of managed update with zero update RPCs. QEMU readback keeps `account_1` / `offline-ui-check`, auto-login disabled, no login task, and no Portal request; the script page has no literal null child or previous-version rollback wording. Independent Sol r19 review returned `PASS`; no P0/P1 remains. Remaining P2s are limited to the discarded old full-page confirmation capture and a global bootstrap ACL warning outside the tested routes.

## Next task checklist

1. Read `AGENTS.md` and `dev/plan/multilogin-v3.md` before v3 edits.
2. Keep local `node_modules/`, `package.json`, and `package-lock.json` ignored and out of commits; `.gitignore` now records these rules.
3. Choose `LUNA_LOCAL` unless there are independent disjoint packets or a genuine high-impact decision.
4. Run only the bounded validation appropriate to the changed files.
5. Record accepted changes, evidence, decisions, risks, and deferred manual items in the execution plan.
6. Do not use r20-r23 QEMU artifacts as a real-device RC candidate. First resolve the package/script version divergence and complete the explicitly authorized Phase 9 device cells, including `PORTAL-03A`. Disposable QEMU evidence remains smoke evidence only.
7. Do not push, release, install packages, mutate a real device, or perform portal login/logout without explicit authorization.
