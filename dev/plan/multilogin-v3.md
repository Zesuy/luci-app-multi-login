# MultiLogin v3 Execution Plan

Status: **Phase 2 accepted; Phase 3 not started**

Target branch: `codex/v3-product-rework`

Target release: `v3.0.0` (first candidate: `v3.0.0-rc.1`)

Baseline: `main` at `fb272e8`, package `2.2.0-4`

This is the durable control document for unattended, multi-agent execution. Read it completely before v3 work. Work on one phase at a time and do not implement the next phase until the current automated gate is accepted by an independent reviewer.

## Fixed decisions

- `login_control.bash` remains package-managed and owns multi-instance scheduling and backoff.
- A single updateable `/etc/multilogin/cqu-portal.sh` owns `status`, `login`, and `logout`.
- Legacy `login.sh`, `check_status.sh`, and `logout.sh` become thin compatibility wrappers.
- GitHub updates only `cqu-portal.sh` from the fixed repository Raw URL; they never update the package.
- Remote scripts are staged, validated, manually activated, and automatically rolled back on failure.
- LuCI uses fixed `multilogin` RPC methods; it must not directly read, write, chmod, or execute scripts.
- Managed mode is the default. Custom scripts are drafts until explicitly validated and activated.

## Repository findings that constrain the work

- The current UCI schema has `settings.global`, `account`, and `instance` sections. Timing keys and account references are already user data and must migrate without renaming.
- `login.sh` and `login_huxi.sh` are byte-identical. `login_A.sh` is obsolete HTTP/801 logic and must not remain an activatable stock template.
- `check_status.sh` delegates to `login.sh --check-only`; `logout.sh` duplicates helpers, calls `checkLogout` before `mac/unbind`, and does not poll until offline.
- `login_control.bash` passes passwords in argv, uses `eval`, and writes predictable `/tmp/login_output_<interface>` files. Its exponential-backoff role is retained, but its implementation is hardened in Phase 3.
- The current rpcd backend also passes passwords in argv and emits script output. Its quick-setup methods mutate every matching `auto_*` object without ownership metadata or a recovery journal.
- The LuCI script view directly reads/writes/chmods `login.sh`, can overwrite it with obsolete templates, and immediately restarts the service. The ACL grants broad file access.
- The package has no pre-install migration, automated tests, CI, or release workflow. `postinst` enables the service unconditionally on a live root.
- `PROJECT_OVERVIEW.md` describes an obsolete Lua layout and both main documents show secret-bearing command examples; documentation must be corrected before release.

## Portal baseline and safety constraints

Use the dated, local `debug-cqu-portal` profile as the protocol baseline. Do not copy retained credentials or raw captures into the repository.

- API: `https://login.cqu.edu.cn:802`.
- Status: `/eportal/portal/online_list`; classify PC/mobile with `list[].phone_flag`.
- Login: `/eportal/portal/login`; HTTP `User-Agent` must exactly equal `term_ua`.
- Logout: `mac/unbind`, then `custom/checkLogout`, then bounded `online_list` polling until `result=0`.
- The installed `mwan3 use` splits arguments containing spaces because it executes unquoted `$*`. The portal script therefore creates a mode-0600 curl config and invokes only `mwan3 use "$interface" curl --config "$config"`.
- All development through Phase 8 uses redacted fixtures, mocks, and simulated root filesystems. No real portal login/logout, real credentials, real router mutation, or real network/firewall/mwan3 change is authorized.

## Execution and acceptance model

### Phase state machine

Each phase uses this state sequence:

`pending -> investigating -> implementing -> self-tested -> independent-review -> accepted`

`blocked` is used only when no safe in-scope work remains. A normal defect returns the phase to `implementing`; it is fixed, retested, and rereviewed without user intervention.

An automated gate may be recorded as `PASS-AUTOMATED` with named `DEFERRED-MANUAL` checks. This counts as acceptance for progression only when the deferred check is explicitly prohibited by the human-intervention boundary and is also listed in Phase 9. A reviewer must confirm that no code-testable requirement was deferred.

### Agent roles

- **Main agent / phase owner:** performs CodeGraph-first structural investigation, freezes the phase scope, assigns non-overlapping file ownership, integrates work, runs the full gate, records evidence, and decides whether review findings are blocking.
- **Implementation subagent:** changes only the assigned files or responsibility. It must read this plan and `AGENTS.md`, preserve unrelated edits, run focused tests, and report changed files, commands, results, assumptions, and risks.
- **Test subagent:** owns tests/fixtures or performs adversarial validation independently of implementation. It must add a failing regression case before or with a bug fix when practical, and must inspect secret leakage and failure paths, not only happy paths.
- **Review subagent:** is read-only for the review turn. It receives the phase diff, contract, gate, and test summary; checks correctness, compatibility, security, and scope; then returns exactly `PASS` or `BLOCK` followed by evidence. It must not review its own implementation.

The main agent does not delegate initial structural exploration. Implementation and test work may run concurrently only when file ownership is disjoint and the phase contract is already frozen. Review starts only after the integrated full gate passes.

### Required phase record

At every state transition, update `## Progress log` in this file. An accepted phase entry must contain:

- phase, state, start/end timestamp, and responsible agents;
- baseline and accepted commit IDs;
- files/contract surfaces changed;
- exact validation commands and summarized results, including expected-failure tests;
- independent-review verdict and resolved findings;
- decisions added to the decision log;
- remaining risks and every `DEFERRED-MANUAL` item.

Do not commit large logs, SDKs, captures, credentials, runtime candidates, or device backups. Small redacted fixtures and deterministic reports belong in the repository. Commit the plan record with the phase changes so a new agent can resume from Git alone. Although `/dev/plan/` is ignored for scratch material, this control document is force-added in the initial plan commit; after it is tracked, normal diffs and phase commits must continue to include it.

### General gate rules

- Run focused tests during implementation, then the repository-wide test command before review.
- Tests must run without Internet or a campus network unless the phase explicitly tests a fixed Raw download through a local HTTP mock.
- Intentional invalid syntax, invalid metadata, secret sentinels, interrupted writes, and command failures must fail safely.
- Preserve UCI fields, non-secret CLI flags, observable exit meanings, service enabled/running state, and custom user data unless the Phase 0 contract records a deliberate break.
- Never place a password in argv, logs, RPC output, browser-visible UCI payloads, fixtures, diagnostics, or committed test artifacts. Internal v3 callers use stdin. The Phase 0 contract must explicitly resolve the legacy `--password` incompatibility.
- Every write/update/migration path must be atomic where possible, lock against concurrency, and have a tested recovery or rollback path.

## Dependencies

- Phase 0 freezes all public and migration contracts.
- Phase 1 supplies the harness required by Phases 2–8.
- Phase 2 supplies the unified script API required by Phases 3–6.
- Phase 3 integrates both the controller and the three existing RPC action launchers before compatibility wrappers and migration are finalized in Phase 4.
- Phase 4 establishes install/upgrade/downgrade behavior before update activation in Phase 5.
- Phase 5 supplies fixed RPC methods used by the Phase 6 UI.
- Phase 6 must land before Phase 7 reorganizes product navigation and permissions.
- Phase 7 freezes the product/RPC/ownership surface consumed by Phase 8 release tests.
- Phase 8 produces the RC artifacts and evidence consumed by Phase 9.
- Phase 9 is the only phase permitted to perform real device or portal acceptance, and only after explicit approval.

## Phases and gates

### Phase 0 — Baseline and contracts

Create the branch; record v2 UCI, RPC, CLI, exit codes, paths, service state, and stock script hashes. Define the v3 script API, outcomes, metadata, fixed Raw URL, migration rules, and supported downgrade target.

**Pre-phase investigation**

1. Record Git/package baseline, file modes and SHA-256 hashes for installed stock files.
2. Inventory Makefile lifecycle hooks, procd behavior, UCI defaults/fields, rpcd list/method envelopes, menu/ACL permissions, LuCI callers, and documentation promises.
3. Record current action-script flags and exit codes from executable behavior, including malformed arguments and missing dependencies; do not call the portal.
4. Compare the current login/logout/status request construction with the redacted portal profile and list all protocol deltas.
5. Identify the exact v2 downgrade artifact/version and the state that v3 must leave for it.

**Detailed tasks and ownership**

- Main agent writes `docs/v3/contracts.md` with paths, UCI/RPC/CLI contracts, exit/outcome table, service-state rules, trust boundaries, migration states, and compatibility exceptions.
- Implementation subagent may generate a deterministic baseline inventory/hash report; it owns only the baseline tooling/report.
- Test subagent independently enumerates public surfaces and checks the contract against current behavior and portal fixtures.
- Freeze the fixed Raw URL as `https://raw.githubusercontent.com/Zesuy/luci-app-multi-login/main/etc/multilogin/cqu-portal.sh` and metadata/API compatibility rules.
- Define managed/current/candidate/last-known-good/custom-draft/custom-backup paths, owners, modes, locks, and atomic rename behavior.
- Define `cqu-portal.sh status|login|logout|version|self-test`, stdin credential framing, machine-readable output, logging redaction, and the exit-code compatibility map.
- Explicitly document that internal v3 callers never use `--password`; decide and test whether legacy wrappers reject it with migration guidance or support a tightly bounded transition without being used by the product.

**Acceptance and verification**

- Baseline report is reproducible and contains no secret values.
- Every current UCI field, RPC method, CLI flag/exit code, installed path, lifecycle hook, and ACL grant maps to preserve/change/remove with a target phase.
- Contracts contain no unresolved wording such as “TBD” for a surface required by Phase 1 or 2.
- Independent reviewer reconciles the contract with repository source and the portal profile.

Gate: contracts are unambiguous, the worktree baseline is clean, and the baseline is committed.

### Phase 1 — Test foundation

Add an offline test runner, redacted JSONP fixtures, command mocks, BusyBox ash checks, ShellCheck, shfmt, JSON/ACL validation, and secret-sentinel tests. Add the initial PR CI workflow.

**Pre-phase investigation**

1. Detect locally available `bash`, BusyBox `ash`, ShellCheck, shfmt, JSON tools, Node, and workflow validators; record optional versus mandatory tools.
2. Determine which OpenWrt commands require mocks: `uci`, `ubus`, `jsonfilter`, `ifstatus`, `ip`, `mwan3`, `curl`, `logger`, `procd`, init scripts, filesystem capacity, clock, randomness, and signals.
3. Design fixtures from the profile for offline/PC/mobile/auth failure/transport error/malformed JSONP/logout delay without retaining real IPs, MACs, accounts, or messages that identify a user.

**Detailed tasks and ownership**

- Test subagent owns `tests/`, fixtures, mocks, the single runner, and test documentation.
- Implementation subagent owns CI/workflow and formatting/lint configuration; it must not weaken tests when adapting CI.
- Provide deterministic temp roots, PATH-injected command mocks, fake time/randomness, captured argv/stdin/stdout/stderr, and cleanup assertions.
- Add syntax checks for all shell/JSON/JavaScript files and a scanner for credential patterns, sentinel values, unsafe temp names, `eval`, and secret-bearing subprocess argv.
- Add expected-failure self-tests proving bad syntax, malformed fixtures, a leaked sentinel, and a failed command make the runner nonzero.
- CI starts with offline lint/unit tests and artifact-free logs; pin actions and least-privilege permissions.

**Acceptance and verification**

- One documented command runs the complete local suite from a clean checkout.
- The runner works under the supported host shell and invokes BusyBox `ash` for POSIX scripts when available; CI makes it mandatory.
- Fixtures pass a secret/identifier audit and all mocks prove that no unexpected network or host mutation occurs.
- Reviewer reruns the suite and at least one expected-failure case independently.

Gate: one command runs all tests; fixtures contain no secrets; intentional bad cases fail.

### Phase 2 — Unified portal script

Implement `cqu-portal.sh status|login|logout|version|self-test`. Share interface, IP, MAC, Base64, JSONP, curl, UA, logging, and parsing code. Use password stdin and a root-only curl config so mwan3 cannot split the UA. Verify `User-Agent == term_ua`, `phone_flag`, and `unbind -> checkLogout -> bounded offline polling`.

**Pre-phase investigation**

1. Reconcile each request parameter, encoding rule, endpoint, result field, classification rule, timeout, and logout sequence with the Phase 0 contract and fixtures.
2. Confirm BusyBox/POSIX availability for `mktemp`, `chmod`, `trap`, Base64, SHA-256, JSON parsing, and curl config syntax.
3. Threat-model secret lifetime, curl config cleanup, signals, concurrent actions, hostile response text, and log/RPC redaction.

**Detailed tasks and ownership**

- Implementation subagent owns `etc/multilogin/cqu-portal.sh` only and implements the frozen API without controller/RPC changes.
- Test subagent owns protocol fixtures/mocks and black-box action tests, including exact curl config inspection.
- Resolve logical interface/device, IPv4/optional IPv6/MAC, normalize MAC, and encode only fields required by the profile.
- Use a mode-0600 temp directory/config, supply the password through stdin, invoke `mwan3 use <iface> curl --config <path>` without space-bearing arguments, and remove secrets on every exit/signal.
- Match header UA and `term_ua`; after successful login, confirm expected `phone_flag`; classify already-online distinctly.
- Implement logout as unbind, checkLogout, then bounded poll with test-injected sleep; never report success before offline.
- Keep `self-test` strictly offline and make `version` expose script/API metadata used by the update backend.

**Acceptance and verification**

- Black-box tests cover both UAs, IPv4/IPv6, missing interface data, offline/online, auth/protocol/transport failures, malformed JSONP, dependency absence, timeout, signal cleanup, and concurrent temp isolation.
- Captured curl invocation has no password or spaced UA; config permissions/content are correct and deleted afterward.
- Responses and logs contain stable outcomes and no raw password or unsafe echoed portal payload.
- Real-device status/login/logout is recorded `DEFERRED-MANUAL`; offline device-command mocks satisfy the automated portion and the real check is repeated in Phase 9.

Gate: all offline protocol tests pass; no secret leaks; read-only device status passes. Real login/logout requires user approval and retained evidence.

Current-run gate interpretation: preserve the original release gate above, but substitute the offline mocked device-status boundary for progression through Phase 8. The real read-only device-status clause is `DEFERRED-MANUAL` to Phase 9 under the user's explicit fixture/mock-only restriction; it must pass before RC device acceptance can pass.

### Phase 3 — Controller integration

Call `cqu-portal.sh login` from `login_control.bash`. Remove `eval`, use secure temporary files, pass passwords via stdin, classify failures, preserve per-instance exponential backoff, cap delays, reset on success, and add small retry jitter.

**Pre-phase investigation**

1. Trace UCI loading, per-instance arrays, mwan3 status parsing, last-attempt timing, service-disable behavior, signals, every current delay transition, and the rpcd `check_instance`/`test_instance`/`logout_instance` child-process paths.
2. Freeze outcome-to-delay behavior from the Phase 0 contract, including whether auth failures back off differently from transport/protocol failures.
3. Define deterministic jitter injection and upper/lower bounds so tests cannot flake or create login storms.

**Detailed tasks and ownership**

- Controller implementation subagent owns `login_control.bash` and no portal-script code.
- A disjoint RPC-launcher implementation subagent owns only the `check_instance`, `test_instance`, and `logout_instance` launch/result paths in `root/usr/libexec/rpcd/multilogin`; full update/configuration RPC refactoring remains Phase 5/7.
- Test subagent owns fake-clock/multi-instance/controller integration tests.
- Replace indirection/eval with indexed arrays or safe namerefs compatible with packaged Bash; quote all values.
- Pipe each password to the portal script, capture only redacted output in a `mktemp` file/directory, and clean up on normal/signal exits.
- Migrate the three current RPC actions to `cqu-portal.sh`: status/logout pass no password; login pipes the UCI password through stdin. Preserve safe legacy top-level action fields for cached LuCI, but never return username or arbitrary child output.
- Preserve the existing UCI timing keys and exponential-backoff responsibility; cap before adding bounded jitter and reset deterministically on success/interface recovery.
- Distinguish success, already-online, auth rejection, transport/protocol error, local configuration error, and disabled/no-instance behavior without busy loops.

**Acceptance and verification**

- Fake-time tests assert exact base delay, cap, reset, jitter bounds, no cross-instance delay contamination, and no retry before due time.
- Process-capture tests prove passwords are stdin-only and absent from argv, log, temp filenames, output, and crash paths.
- RPC action tests prove check/test/logout remain callable before Phase 4 wrapper replacement and preserve their safe cached-client status/code behavior.
- Service disable/no-instance/mwan3-unavailable/signal tests terminate or sleep as contracted without host mutation.

Gate: mocked timing tests cover success, auth failure, transport failure, already-online, multiple instances, delay reset/cap, and service disabled state.

### Phase 4 — Compatibility and migration

Convert old action scripts to wrappers. In `preinst`, snapshot legacy files before unpacking. After unpacking, classify known stock hashes versus custom scripts, preserve custom bundles without activating them, migrate idempotently, and restore the previous enabled/running state. Prove the supported v2 downgrade lifecycle.

**Pre-phase investigation**

1. Capture stock hashes/modes for every supported v2 source version and determine opkg ordering for `preinst`, unpack, `postinst`, `prerm`, and `postrm` with and without `IPKG_INSTROOT`.
2. Define fresh/stock/custom/partial-v3 states, service enabled/running markers, disk-full/interruption points, and downgrade expectations.
3. Inventory documentation or LuCI callers that still invoke legacy action paths or `--check-only`.

**Detailed tasks and ownership**

- Implementation subagent owns Makefile lifecycle hooks, migration helper, wrappers, and package file list.
- Test subagent owns simulated-rootfs/opkg lifecycle tests and immutable input bundles for stock/custom cases.
- Wrappers translate supported non-secret legacy flags to `cqu-portal.sh` actions and preserve contracted exit meanings; internal callers never depend on secret argv.
- `preinst` records service state and snapshots legacy scripts before overwrite. `postinst` classifies exact stock hashes, preserves unknown/custom bundles with metadata, installs managed mode, and restores prior enabled/running state.
- All migration writes use a lock, journal/states, mode checks, atomic rename, sufficient-space check, and idempotent recovery.
- Define and test downgrade to `2.2.0-4`; preserve a recoverable custom bundle and remove only v3-owned runtime state.

**Acceptance and verification**

- Tests compare full trees, modes, hashes, service calls, and journals for fresh install, stock/custom upgrade, interruption at each write boundary, rerun, restart, uninstall, and downgrade.
- No custom content is executed or overwritten, and failed migrations leave either the old working state or a resumable journal.
- Package-managed versus runtime-updateable ownership is explicit in manifests and tests.

Gate: fresh, stock-upgrade, custom-upgrade, interrupted migration, repeated migration, restart, and supported downgrade tests pass without data loss.

### Phase 5 — Raw update backend

Add fixed RPC methods for script info, check, stage, validate, activate, rollback, and restore. Enforce the fixed GitHub host/repository/path, size and timeout limits, metadata/API checks, `sh -n`, `self-test`, SHA-256, locking, candidate isolation, last-known-good backup, atomic activation, and post-activation read-only status validation.

**Pre-phase investigation**

1. Inventory current rpcd input parsing, envelopes, action outputs, ACL exposure, account lookup, and service restart behavior.
2. Freeze method names/parameters/envelopes and state transitions for managed/custom modes; client input must never contain a URL or filesystem path.
3. Threat-model redirects, DNS/TLS errors, oversized/chunked downloads, low space, downgrade/replay, concurrent calls, interrupted rename, malicious metadata, and validation command escape.

**Detailed tasks and ownership**

- Implementation subagent owns backend helpers/RPC, update state storage, and the Custom draft get/save/discard backend required by Phase 6; it does not edit LuCI views.
- Test subagent owns local HTTP/curl mocks and backend state-machine/concurrency tests.
- Implement fixed methods for info/check/stage/validate/activate/rollback/restore with a consistent non-secret envelope and bounded diagnostics.
- Implement fixed Custom draft get/save/discard methods with base-hash concurrency and the same isolation/locking rules, but do not build their LuCI UI yet.
- Enforce HTTPS, exact fixed Raw origin/path, redirect policy, timeout/size limits, regular-file/mode checks, API/version metadata, and `sh -n` during non-executing stage. Because OpenWrt provides no assumed shell sandbox, executable `self-test` validation requires explicit root-code confirmation plus the exact staged hash; unattended tests execute only fixtures/mocks.
- Lock all mutations; isolate candidate and custom draft; hash every state; preserve last-known-good; fsync/atomic rename where available; journal activation.
- After activation run offline self-test plus a status call. During unattended execution the status call uses mocks; a real read-only status is `DEFERRED-MANUAL`. Roll back automatically on failure.
- Never download or replace the IPK, controller, RPC, UI, config, or any file other than the managed `cqu-portal.sh` state.

**Acceptance and verification**

- State-machine tests assert exact active/candidate/LKG hashes and modes after every success/failure/interruption.
- Redirect/host/path/size/timeout/disk/concurrency/metadata/API/syntax/self-test/status failures reject or roll back with no partial active file.
- RPC fuzz tests reject unknown fields/paths and never return source containing credentials or arbitrary command output.

Gate: no-update, valid update, downgrade, bad syntax/API, timeout, redirect, low-space, concurrency, interrupted activation, failed status, and rollback tests pass. No package file is updated.

### Phase 6 — LuCI script manager

Replace direct file editing and template overwrite with Managed and Custom modes. Managed mode shows versions, source, hashes, candidate state, update, activation, and rollback. Custom mode uses draft/save/validate/activate/discard with a base hash and an explicit root-code warning.

**Pre-phase investigation**

1. Map current form lifecycle, direct `fs` operations, restart behavior, menu/ACL grants, translation conventions, loading/error behavior, and 375px layout constraints.
2. Define UI state diagrams for managed current/candidate/LKG and custom clean/dirty/validated/conflict/active states.
3. Freeze optimistic-concurrency/base-hash behavior, destructive confirmations, and recovery affordances against Phase 5 RPC contracts.

**Detailed tasks and ownership**

- Implementation subagent owns the script-manager LuCI view/menu changes only.
- Test subagent owns RPC stubs, render/action state tests, static ACL assertions, keyboard checks, and narrow-viewport evidence.
- Remove `fs.read`, `fs.write`, `fs.exec`, obsolete template activation, and implicit service restart from the browser.
- Managed mode displays immutable source identity, versions/hashes, candidate validation, explicit activation, rollback, and restore actions.
- Custom mode edits a server-side draft, never the active file; save with base hash, require explicit root-code confirmation before executable validation, explicitly activate, discard, and recover conflict without losing typed content.
- Disable duplicate actions, show progress, preserve actionable errors, require confirmation for activation/rollback/discard, and display a root-code warning.

**Acceptance and verification**

- Browser-side code can invoke only fixed RPC methods and cannot supply arbitrary file paths/commands/URLs.
- UI tests cover empty/loading/error/offline/conflict/invalid/activation-failure/rollback states and keyboard focus.
- 375px evidence shows no unreachable action or horizontal page overflow; source editor may scroll internally.

Gate: no broad file ACL; unvalidated code cannot activate; concurrent edits are rejected; actions have loading/error/recovery states; keyboard and 375px layouts pass.

### Phase 7 — Product and permission cleanup

Organize LuCI into Overview, Configuration, Network, Scripts, and Diagnostics. Return only `password_set` to browsers, use a consistent RPC envelope, narrow ACLs, protect account references, and add ownership markers plus a persistent recovery journal for network/firewall/mwan3 changes.

**Pre-phase investigation**

1. Map all LuCI-to-RPC/UCI data flows and identify browser-readable account/password fields, shell interpolation, JSON escaping, broad UCI/file/ubus grants, and log exposure.
2. Model quick-setup/remove operations across network/firewall/mwan3, including collisions with user-created `auto_*` names and interruption/reboot points.
3. Define final information architecture, shared response envelope, resource ownership IDs, transaction journal, recovery rules, and compatibility adapters.

**Detailed tasks and ownership**

- Backend implementation subagent owns RPC envelope, password handling, ownership markers/journal, and recovery command.
- UI implementation subagent owns navigation/page organization and shared empty/loading/error components; file ownership must not overlap backend work.
- Test subagent owns secret-taint tests, ACL negative tests, JSON/input fuzzing, transaction failure injection, and reboot recovery simulation.
- Keep passwords write-only: blank means unchanged for an existing account; browser reads return only `password_set`; action output is allowlisted/redacted.
- Replace prefix-based deletion with exact ownership records. Snapshot affected UCI sections, journal each stage, commit/reload in order, and recover/roll back after reboot.
- Narrow ACL to the exact UCI/RPC/init/log operations required; no broad filesystem script write and no arbitrary `file` exec/read/write.
- Update README and project overview to the actual v3 architecture without credential-bearing examples.

**Acceptance and verification**

- Sentinel credentials never appear in browser fixtures, RPC/stdout/stderr, logs, process listings, temp paths/content after cleanup, or committed files.
- Negative ACL tests deny direct file/script access and unrelated UCI/ubus operations while all pages retain required functionality.
- Transaction tests preserve non-owned objects byte-for-byte and restore a consistent state after failure/reboot at every journal stage.

Gate: browser/RPC/log output has no secrets; non-owned network objects are untouched; interrupted network transactions recover after reboot; all pages have empty/loading/error states.

### Phase 8 — Build and release automation

Complete PR CI, reusable OpenWrt 23.05/24.10 SDK builds, package lifecycle tests, script-version gates, release checks, checksums, changelog validation, and approved GitHub Releases. Snapshot builds remain non-blocking.

**Pre-phase investigation**

1. Identify supported SDK targets/architectures, runner images, package dependencies, artifact naming, current tag/version conventions, and repository GitHub permissions.
2. Separate shell-only publication from IPK release: determine which paths require script API/version bump, package version/release bump, both, or neither.
3. Define RC/stable tag policy, reproducibility data, checksum format, changelog sections, provenance, permissions, concurrency, and approval environments.

**Detailed tasks and ownership**

- CI implementation subagent owns PR/lint/unit workflows and reusable SDK build workflow.
- Release implementation subagent owns version/checksum/changelog/release workflows and does not publish anything.
- Test subagent owns workflow static checks, local lifecycle simulation, artifact inspection scripts, and version-matrix expected failures.
- CI runs the single offline test command, JSON/JS/shell validation, secret scanning, migration/lifecycle tests, and supported SDK builds with pinned/minimal permissions.
- Release checks require tag/Makefile/script metadata/changelog/artifact names/checksums to agree; RC is `v3.0.0-rc.1` and stable is `v3.0.0`.
- Shell-only changes validate and may update only the fixed Raw script on `main`; they do not claim an IPK update. Package/API changes require the full release gate.
- Publishing, branch push, tags, GitHub environments, and Releases are manual-authority operations. Workflows may be created and tested but are never dispatched/published unattended.

**Acceptance and verification**

- Local/static workflow validation passes and package files install/uninstall/upgrade/downgrade correctly in simulated rootfs.
- Supported SDK builds use reproducibly identified cached SDK inputs or safely downloaded SDKs. If a required SDK cannot be obtained or executed after bounded retries, Phase 8 is `blocked`; this is not a `DEFERRED-MANUAL` gate item.
- Artifact inspection proves file list/modes/dependencies/versions and checksums; intentionally mismatched metadata fails.

Gate: supported SDK packages build and install in a simulated rootfs; tag, Makefile, artifacts, and notes agree; shell-only changes pass their dedicated gate without requiring an IPK release.

### Phase 9 — RC device acceptance

Test fresh install, stock/custom upgrade, service-state preservation, single/multiple instances, PC/mobile classification, IPv4/IPv6, failures, logout delay, Raw update/rollback, Custom preservation, reboot recovery, network journal recovery, and the supported v2 downgrade.

**Pre-phase investigation**

1. Prepare an operator checklist with device model/OpenWrt/mwan3 versions, backup/restore steps, isolated test accounts, WAN mapping, evidence paths, abort thresholds, and rollback commands.
2. Reconcile every `DEFERRED-MANUAL` item from Phases 2, 5, and 8; no item may disappear from the checklist.
3. Verify RC artifact/checksum/signature offline and require explicit approval for install, network mutation, portal actions, reboot, downgrade, push/tag/release, and credential use.

**Detailed tasks and ownership**

- Main agent prepares the checklist, evidence template, command-by-command safety review, and read-only preflight. It does not act on a real device without approval.
- Test subagent reviews coverage and acceptance thresholds against earlier contracts and failure modes.
- After approval, an implementation/operator agent may execute only the specifically authorized device steps, stopping on secret leakage, unexpected object ownership, repeated login attempts, rollback failure, or loss of management access.
- Review subagent audits retained redacted evidence and defects; product owner decides subjective UX and stable release readiness.

**Acceptance and verification**

- Every matrix cell records environment, precondition, action, expected/actual result, timestamp, redacted evidence, cleanup, and defect link.
- Soak monitoring has explicit duration, retry-storm threshold, secret scan, service/resource health checks, and rollback verification.
- No stable tag/release is created until the user accepts device evidence and explicitly authorizes publication.

Gate: the RC completes the soak period without login storms, secret leaks, P0/P1 defects, migration loss, or failed rollback. Then publish `v3.0.0`.

Gate interpretation: the Phase 9 gate ends at documented RC acceptance. The original “Then publish” sentence describes the next release action, not pre-authorization; pushing, tagging, or publishing `v3.0.0` occurs only after a separate explicit user authorization.

## Human-intervention boundary

The unattended executor must stop before, but only before, the following actions. It should first finish every remaining offline/reversible task and provide exact commands/checklists:

- using a real account/password or retrieving credentials from a router/browser/capture;
- real portal login, logout, unbind, or any request intended to change authentication state;
- installing, removing, upgrading, or downgrading an IPK on a real device;
- changing or reloading a real device's network, firewall, mwan3, DHCP, routing, service state, or rebooting it;
- executing validation/self-test for, or activating, a downloaded/custom script on a real device;
- choosing unresolved product behavior or accepting subjective UX/visual results;
- pushing a branch, opening/merging a PR, creating a tag, dispatching a privileged workflow, or publishing a GitHub Release;
- destructive cleanup outside a test root or any step that risks losing management access.

Allowed unattended work includes local branches/commits, offline mocks/fixtures, simulated rootfs/package lifecycle, local HTTP servers, source downloads/build caches that do not mutate external services, and read-only repository inspection. For this run, even real read-only portal/device checks are deferred to Phase 9 because the user required portal work to remain fixture/mock-only.

## Decision log

| ID | Decision | Reason | Phase |
| --- | --- | --- | --- |
| D-001 | Keep scheduling/backoff in package-managed `login_control.bash`. | Remote shell updates must not change product scheduling or multi-instance policy. | Fixed |
| D-002 | Update only unified `cqu-portal.sh` from the fixed Raw URL. | Shell protocol fixes can ship independently without turning Raw into a package updater. | Fixed |
| D-003 | Use staged validation, explicit activation, LKG, and automatic rollback. | Remote/custom root code must never overwrite the active script directly. | Fixed |
| D-004 | Use offline fixtures/mocks through Phase 8; defer all real device/portal checks. | Current authorization explicitly prohibits real portal and device mutation. | All |
| D-005 | Preserve the exponential-backoff policy but harden its implementation and add bounded jitter. | Existing product behavior remains recognizable while preventing unsafe argv/eval/temp handling and synchronized retries. | 3 |
| D-006 | Treat `ok` as a trustworthy action result rather than “online”; offline status and already-online are non-error outcomes despite exits 1/2. | Exit codes preserve CLI state semantics while JSON can distinguish valid state from auth/transport failure. | 2 |

## Progress log

| Phase | State | Evidence / commit | Review | Decisions / remaining risks |
| --- | --- | --- | --- | --- |
| Plan | accepted | Repository, portal profile, and existing plan inspected on 2026-07-31. Initial review returned `BLOCK`; four gate/durability ambiguities were corrected. | Independent reviewer `/root/plan_review`: `PASS`. | Plan is tracked and committed before Phase 0. |
| 0 | accepted | 2026-07-31; main agent, `/root/phase0_baseline`, `/root/phase0_audit`; accepted content commit `b4fe21e66d0337839788e75e8392f77e922f329d`. Checks passed: shell/Bash/JS syntax, JSON, two byte-identical baseline reproductions, stock-script equality, contract UCI/RPC/exit coverage, secret-placeholder scan, and `git diff --check`. | Test/audit final `PASS`; independent reviewer `/root/phase0_review` found and verified the Phase 3 rpcd-launcher ordering fix, then returned `PASS`. | ShellCheck and BusyBox unavailable locally; mandatory in Phase 1 CI. Real device/portal actions and candidate root-code validation remain Phase 9 manual items. |
| 1 | accepted | 2026-07-31; main agent, `/root/phase1_tests`, `/root/phase1_ci`; accepted content commit `f0ebfe2e88181178edfef682a9f977e36f7dfc77`. Local `14 PASS/3 SKIP`; required BusyBox/ShellCheck/shfmt mode final `18 PASS/0 SKIP`; missing-tool CI negative, all intentional bad cases, workflow full-history/pins/permissions, and diff checks passed. | `/root/phase1_review` blocked shallow checkout and incomplete future lint scope; fixes were rerun and reviewer returned `PASS`. | Generic mocks must be extended, not weakened. All shell files changed from the v2 baseline automatically enter lint. |
| 2 | accepted | 2026-07-31; `/root/phase2_script` and Luna `/root/phase2_tests_luna`; accepted content commit `8b31696fd78857b6ff63f04d1c09082a9e70c560`. Direct offline version/self-test and required BusyBox/ShellCheck/shfmt runner passed (`19 PASS/0 SKIP`); portal groups cover strict CLI, PC/mobile, exact config/UA, stdin secret framing, ret-code race, classification, IPv4/IPv6, logout precedence/bounds, identity ambiguity, signals, and concurrency. | Independent Terra reviewer `/root/phase2_review`: `PASS`. | Real read-only status/login/logout remain `DEFERRED-MANUAL` to Phase 9; no real portal/device action occurred. |
| 3 | pending | Not started. | — | — |
| 4 | pending | Not started. | — | — |
| 5 | pending | Not started. | — | Real post-activation status deferred. |
| 6 | pending | Not started. | — | Subjective UX acceptance remains manual. |
| 7 | pending | Not started. | — | — |
| 8 | pending | Not started. | — | Push/tag/release remain manual; failure to obtain/run a required SDK blocks the phase. |
| 9 | pending | Not started. | — | Entire real-device matrix requires explicit authorization. |
