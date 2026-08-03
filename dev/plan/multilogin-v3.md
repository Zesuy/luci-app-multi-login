# MultiLogin v3 Execution Plan

Status: **Phase 9 blocked pending explicit human authorization and required external inputs**

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
- Unattended acceptance is limited to compilation, static analysis, artifact inspection, and pure product-logic tests. It does not emulate OpenWrt, opkg, procd, UCI, services, routing, reboot, or a router root filesystem.
- Ordinary push/PR CI always runs the bounded code/static/pure-logic gate. Package-scope changes additionally compile and inspect a 24.10 IPK plus a 25.12 APK; shell-only and documentation scopes skip SDK compilation. Manual Release validation reruns the same two-format matrix.
- QEMU is not part of the unattended default gate and must not grow into a fake OpenWrt platform. A disposable QEMU may run a narrow, real-package regression smoke (especially rpcd/JSHN request/response behavior) before a real-device retry; package-manager, lifecycle, service, mwan3, network, and portal acceptance remain Phase 9 checks.

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
- All development through Phase 8 uses redacted protocol fixtures and host-independent logic inputs only. No real portal login/logout, real credentials, router/rootfs emulation, real router mutation, or real network/firewall/mwan3 change is authorized.

## Execution and acceptance model

### Phase state machine

Each phase uses this state sequence:

`pending -> investigating -> implementing -> self-tested -> independent-review -> accepted`

`blocked` is used only when no safe in-scope work remains. A normal defect returns the phase to `implementing`; it is fixed, retested, and rereviewed without user intervention.

An automated gate may be recorded as `PASS-AUTOMATED` with named `DEFERRED-MANUAL` checks. This counts as acceptance for progression only when the deferred check is explicitly prohibited by the human-intervention boundary and is also listed in Phase 9. A reviewer must confirm that no code-testable requirement was deferred.

### Automated validation scope

- **Compile/static:** shell and JavaScript syntax, ShellCheck, shfmt, JSON/menu/ACL validation, secret/unsafe-pattern scanning, release-validation SDK compilation, workflow validation, and read-only IPK/APK metadata/file-list inspection.
- **Pure logic:** parsers, request/response classification, CLI mapping, retry arithmetic, metadata/version rules, state-transition reducers, ownership plans, validation predicates, and deterministic serialization. Inputs and outputs stay in memory or ordinary temporary files and do not claim operating-system integration.
- **Narrow boundary stubs:** a small child-process stub may capture argv/stdin or return a fixture when required to prove a repository-owned security contract. It must not reproduce OpenWrt command behavior or an opkg/service lifecycle. Executing the real SDK JSHN shell library with BusyBox ash is a library-contract check, not platform emulation; a disposable QEMU package smoke is an optional regression diagnostic outside this default runner.
- **Explicitly out of scope unattended:** simulated router rootfs, fake opkg unpack/hooks, fake procd/init/UCI/ubus/mwan3/network/firewall behavior, service-state matrices, reboot recovery simulation, and full-tree lifecycle emulation.
- End-to-end install, upgrade, downgrade, service restoration, network ownership/recovery, and portal/device behavior are `DEFERRED-MANUAL` to Phase 9. Earlier phases verify their source-level design and compileability only.
- The default local/CI runner contains only the allowed scope above. Historical platform-simulation suites are removed from that runner; they may be deleted or retained only as explicitly non-gating developer diagnostics, and no further effort is spent expanding them.
- Host-only checks use no real sleeps, retry loops, or environment emulation. The ordinary CI code gate has a 60-second non-SDK budget and each child check has an explicit timeout; only package-scope CI and separately dispatched Release validation run the bounded SDK matrix.

### Agent roles

- **Main agent / phase owner:** performs CodeGraph-first structural investigation, freezes the phase scope, assigns non-overlapping file ownership, integrates work, runs the full gate, records evidence, and decides whether review findings are blocking.
- **Implementation subagent:** changes only the assigned files or responsibility. It must read this plan and `AGENTS.md`, preserve unrelated edits, run focused tests, and report changed files, commands, results, assumptions, and risks.
- **Test subagent:** owns tests/fixtures or performs adversarial validation independently of implementation. It must add a failing regression case before or with a bug fix when practical, and must inspect secret leakage and failure paths, not only happy paths.
- **Review subagent:** is read-only for the review turn. It receives the phase diff, contract, gate, and test summary; checks correctness, compatibility, security, and scope; then returns exactly `PASS` or `BLOCK` followed by evidence. It must not review its own implementation.

Model allocation: ordinary test work uses Luna with high reasoning; implementation and independent review use Terra with high reasoning. Sol xhigh is reserved for an explicit escalation, not routine test execution.

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

- Run bounded focused compile/static/pure-logic checks during implementation, then the repository-wide bounded gate before review. Do not run historical platform-simulation suites as part of unattended acceptance.
- Tests must run without Internet or a campus network. Raw download policy is checked as source-level and pure URL/metadata logic; network behavior is not emulated.
- Intentional invalid syntax, invalid metadata, secret sentinels, interrupted writes, and command failures must fail safely.
- Preserve UCI fields, non-secret CLI flags, observable exit meanings, service enabled/running state, and custom user data unless the Phase 0 contract records a deliberate break.
- Never place a password in argv, logs, RPC output, browser-visible UCI payloads, fixtures, diagnostics, or committed test artifacts. Internal v3 callers use stdin. The Phase 0 contract must explicitly resolve the legacy `--password` incompatibility.
- Every write/update/migration path must be atomic where possible and lock against concurrency. Pure transition logic and source ordering are automated; operating-system recovery behavior is verified only in Phase 9.

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

Add a bounded offline test runner, redacted JSONP fixtures, BusyBox ash checks, ShellCheck, shfmt, JSON/ACL validation, secret-sentinel tests, and pure-logic tests. Add the initial PR CI workflow.

**Pre-phase investigation**

1. Detect locally available `bash`, BusyBox `ash`, ShellCheck, shfmt, JSON tools, Node, and workflow validators; record optional versus mandatory tools.
2. Identify repository-owned functions that can be checked without reproducing OpenWrt commands; record every device/OS integration claim as Phase 9 manual coverage.
3. Design fixtures from the profile for offline/PC/mobile/auth failure/transport error/malformed JSONP/logout delay without retaining real IPs, MACs, accounts, or messages that identify a user.

**Detailed tasks and ownership**

- Test subagent owns `tests/`, protocol fixtures, pure-logic cases, the single runner, and test documentation.
- Implementation subagent owns CI/workflow and formatting/lint configuration; it must not weaken tests when adapting CI.
- Provide deterministic logic inputs and outputs. Use only narrow argv/stdin capture stubs for secret-boundary checks; do not build fake router commands, services, package managers, or root filesystems.
- Add syntax checks for all shell/JSON/JavaScript files and a scanner for credential patterns, sentinel values, unsafe temp names, `eval`, and secret-bearing subprocess argv.
- Add expected-failure self-tests proving bad syntax, malformed fixtures, a leaked sentinel, and a failed command make the runner nonzero.
- CI starts with offline lint/unit tests and artifact-free logs; pin actions and least-privilege permissions.

**Acceptance and verification**

- One documented command runs the complete local suite from a clean checkout.
- The runner works under the supported host shell and invokes BusyBox `ash` for POSIX scripts when available; CI makes it mandatory.
- Fixtures pass a secret/identifier audit, and the runner contains no router/package/service/network emulation.
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
- Test subagent owns redacted protocol fixtures and host-independent parser/request/classification tests. A narrow curl-config serializer test may inspect generated text, but it must not emulate mwan3, routing, interfaces, or a portal connection.
- Resolve logical interface/device, IPv4/optional IPv6/MAC, normalize MAC, and encode only fields required by the profile.
- Use a mode-0600 temp directory/config, supply the password through stdin, invoke `mwan3 use <iface> curl --config <path>` without space-bearing arguments, and remove secrets on every exit/signal.
- Match header UA and `term_ua`; after successful login, confirm expected `phone_flag`; classify already-online distinctly.
- Implement logout as unbind, checkLogout, then bounded poll with test-injected sleep; never report success before offline.
- Keep `self-test` strictly offline and make `version` expose script/API metadata used by the update backend.

**Acceptance and verification**

- Pure-logic cases cover both UAs, IPv4/IPv6 serialization, offline/online classification, auth/protocol/transport outcomes, malformed JSONP, and logout polling bounds.
- Source/static checks prove password stdin framing and absence from fixed argv; serializer tests prove UA/config content. Actual mwan3/curl/tempfile behavior is Phase 9 coverage.
- Responses and logs contain stable outcomes and no raw password or unsafe echoed portal payload.
- Real-device status/login/logout, dependency discovery, interface lookup, tempfile cleanup under signals, and mwan3/curl execution are `DEFERRED-MANUAL` to Phase 9.

Gate: shell compiles/lints; protocol parsing, serialization, classification, CLI validation, and secret-boundary logic pass. All device execution is deferred.

Current-run gate interpretation: no mocked device-status substitute is required. The entire device-status clause is `DEFERRED-MANUAL` to Phase 9 and must pass before RC device acceptance.

### Phase 3 — Controller integration

Call `cqu-portal.sh login` from `login_control.bash`. Remove `eval`, use secure temporary files, pass passwords via stdin, classify failures, preserve per-instance exponential backoff, cap delays, reset on success, and add small retry jitter.

**Pre-phase investigation**

1. Trace UCI loading, per-instance arrays, mwan3 status parsing, last-attempt timing, service-disable behavior, signals, every current delay transition, and the rpcd `check_instance`/`test_instance`/`logout_instance` child-process paths.
2. Freeze outcome-to-delay behavior from the Phase 0 contract, including whether auth failures back off differently from transport/protocol failures.
3. Define deterministic jitter injection and upper/lower bounds so tests cannot flake or create login storms.

**Detailed tasks and ownership**

- Controller implementation subagent owns `login_control.bash` and no portal-script code.
- A disjoint RPC-launcher implementation subagent owns only the `check_instance`, `test_instance`, and `logout_instance` launch/result paths in `root/usr/libexec/rpcd/multilogin`; full update/configuration RPC refactoring remains Phase 5/7.
- Test subagent owns extracted/pure retry arithmetic, outcome mapping, and multi-instance state-isolation tests.
- Replace indirection/eval with indexed arrays or safe namerefs compatible with packaged Bash; quote all values.
- Pipe each password to the portal script, capture only redacted output in a `mktemp` file/directory, and clean up on normal/signal exits.
- Migrate the three current RPC actions to `cqu-portal.sh`: status/logout pass no password; login pipes the UCI password through stdin. Preserve safe legacy top-level action fields for cached LuCI, but never return username or arbitrary child output.
- Preserve the existing UCI timing keys and exponential-backoff responsibility; cap before adding bounded jitter and reset deterministically on success/interface recovery.
- Distinguish success, already-online, auth rejection, transport/protocol error, local configuration error, and disabled/no-instance behavior without busy loops.

**Acceptance and verification**

- Pure timing tests assert exact base delay, cap, reset, jitter bounds, no cross-instance delay contamination, and due-time decisions.
- A narrow child stub proves login credentials cross only stdin and not fixed argv. Source/static checks cover log/output/temp-name construction; actual process logs, temp cleanup, and crash behavior are Phase 9 checks.
- RPC action tests prove check/test/logout remain callable before Phase 4 wrapper replacement and preserve their safe cached-client status/code behavior.
- Static control-flow review covers service-disable/no-instance/mwan3-unavailable/signal branches; procd, UCI, mwan3, and process lifecycle are not emulated.

Gate: Bash compiles/lints; pure timing/outcome tests cover success, auth failure, transport failure, already-online, multiple instances, and delay reset/cap; source checks prove no `eval`, secret argv, or predictable temp path.

### Phase 4 — Compatibility and migration

Convert old action scripts to wrappers. Encode `preinst`/`postinst` migration, stock/custom classification, service-state intent, and the supported v2 downgrade contract. Automated work verifies source logic and compileability; real opkg lifecycle behavior is proved only in Phase 9.

**Pre-phase investigation**

1. Capture stock hashes/modes for every supported v2 source version and document the expected hook order from package metadata/OpenWrt documentation without emulating opkg.
2. Define fresh/stock/custom/partial-v3 states, service enabled/running markers, disk-full/interruption points, and downgrade expectations.
3. Inventory documentation or LuCI callers that still invoke legacy action paths or `--check-only`.
4. Classify every current default-runner suite as compile/static, pure logic, narrow security boundary, or platform simulation; freeze a reduced unattended runner before further Phase 4 review.

**Detailed tasks and ownership**

- Implementation subagent owns Makefile lifecycle hooks, migration helper, wrappers, and package file list.
- Test subagent owns the bounded-runner refactor, wrapper CLI mapping, hash/classification predicates, manifest/state serialization, and static package/hook assertions. It does not own a simulated rootfs/opkg/service harness.
- Remove `tests/test-phase4.mjs` from the required runner and extract only its host-independent assertions into a small logic/static suite. Do the same runner-level exclusion for older portal/controller/RPC platform simulations; retain narrow argv/stdin capture only where it directly proves the secret contract.
- Wrappers translate supported non-secret legacy flags to `cqu-portal.sh` actions and preserve contracted exit meanings; internal callers never depend on secret argv.
- `preinst` records service state and snapshots legacy scripts before overwrite. `postinst` classifies exact stock hashes, preserves unknown/custom bundles with metadata, installs managed mode, and restores prior enabled/running state.
- All migration writes use a lock, journal/states, mode checks, atomic rename, sufficient-space check, and idempotent recovery.
- Define and test downgrade to `2.2.0-4`; preserve a recoverable custom bundle and remove only v3-owned runtime state.

**Acceptance and verification**

- Static/source checks confirm package-managed versus runtime-updateable ownership, exact stock hashes, conffile declaration, hook embedding, lock/atomic-write primitives, non-secret manifests, and fail-closed branch ordering.
- Pure logic tests cover wrapper mapping, version/hash classification, lifecycle-state transitions, service-state intent mapping, and downgrade metadata validation without executing an opkg lifecycle.
- Fresh/upgrade/downgrade full-tree results, interruption recovery, modes as installed by opkg, and actual service restoration are `DEFERRED-MANUAL` to Phase 9.

Gate: package and hook sources compile/lint; package file ownership/conffile/static invariants pass; wrapper and migration decision logic pass. No automated claim is made about real fresh install, upgrade, interruption recovery, service restoration, uninstall, or downgrade.

Required unattended command after the runner refactor: `CI=1 MULTILOGIN_REQUIRE_TOOLING=1 ./tests/run.sh`, with BusyBox, ShellCheck, and shfmt available on `PATH`. Its summary must list only compile/static/pure-logic/narrow-boundary groups and complete within a bounded host-only budget.

### Phase 5 — Raw update backend

Add fixed RPC methods for script info, check, stage, validate, activate, rollback, and restore. Enforce the fixed GitHub host/repository/path, size and timeout limits, metadata/API checks, `sh -n`, `self-test`, SHA-256, locking, candidate isolation, last-known-good backup, atomic activation, and post-activation read-only status validation.

**Pre-phase investigation**

1. Inventory current rpcd input parsing, envelopes, action outputs, ACL exposure, account lookup, and service restart behavior.
2. Freeze method names/parameters/envelopes and state transitions for managed/custom modes; client input must never contain a URL or filesystem path.
3. Threat-model redirects, DNS/TLS errors, oversized/chunked downloads, low space, downgrade/replay, concurrent calls, interrupted rename, malicious metadata, and validation command escape.

**Detailed tasks and ownership**

- Implementation subagent owns backend helpers/RPC, update state storage, the narrow init-to-backend recovery call, and the Custom draft get/save/discard backend required by Phase 6; it does not edit LuCI views.
- Test subagent owns pure URL/redirect/metadata/version/recovery-transition validation and RPC input-contract tests. It does not run a local HTTP server or emulate curl/OpenWrt filesystem behavior.
- Implement fixed methods for info/check/stage/validate/activate/rollback/restore with a consistent non-secret envelope and bounded diagnostics.
- Implement fixed Custom draft get/save/discard methods with base-hash concurrency and the same isolation/locking rules, but do not build their LuCI UI yet.
- Enforce HTTPS, exact fixed Raw origin/path, redirect policy, timeout/size limits, regular-file/mode checks, API/version metadata, and `sh -n` during non-executing stage. Because OpenWrt provides no assumed shell sandbox, executable `self-test` validation requires explicit root-code confirmation plus the exact staged hash; unattended tests validate only the decision logic and metadata.
- Lock all mutations; isolate candidate and custom draft; hash every state; preserve last-known-good; fsync/atomic rename where available; journal activation. Add a non-executing recovery entry point that runs before the controller starts and before every script RPC; unresolved recovery blocks controller startup and all script methods except non-source `script_info`.
- After activation run offline self-test plus a status call. Execution, filesystem activation, rollback, curl behavior, and real read-only status are `DEFERRED-MANUAL`; automated tests cover their state-transition decisions only.
- Never download or replace the IPK, controller, RPC, UI, config, or any file other than the managed `cqu-portal.sh` state.

**Acceptance and verification**

- Pure state-machine tests assert intended active/candidate/LKG transitions and rejection decisions for redirect/host/path/size/metadata/API/syntax/self-test/status outcomes.
- Disk, filesystem atomicity, process concurrency, interruption, curl timeout/redirect execution, activation, and rollback are Phase 9 integration checks.
- RPC fuzz tests reject unknown fields/paths and never return source containing credentials or arbitrary command output.

Gate: backend compiles/lints; pure input-validation and state-transition tests cover no-update, valid update, downgrade approval, bad syntax/API, redirect policy, failed validation/status decisions, and rollback selection. No network or package file is updated.

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
- Test subagent owns secret-taint tests, ACL negative/static tests, JSON/input fuzzing, and pure ownership/journal transition tests. It does not emulate UCI/network/firewall/mwan3 commits or reboot recovery.
- Keep passwords write-only: blank means unchanged for an existing account; browser reads return only `password_set`; action output is allowlisted/redacted.
- Replace prefix-based deletion with exact ownership records. Snapshot affected UCI sections, journal each stage, commit/reload in order, and recover/roll back after reboot.
- Narrow ACL to the exact UCI/RPC/init/log operations required; no broad filesystem script write and no arbitrary `file` exec/read/write.
- Update README and project overview to the actual v3 architecture without credential-bearing examples.

**Acceptance and verification**

- Sentinel credentials never appear in browser/RPC serialization fixtures, generated argv/log payload logic, diagnostics, or committed files. Actual process listings, service logs, and temp cleanup are Phase 9 checks.
- Negative ACL tests deny direct file/script access and unrelated UCI/ubus operations while all pages retain required functionality.
- Pure planner/reducer tests prove non-owned object IDs are never selected and each journal state has a defined recovery decision; actual UCI commit/reload and reboot recovery are Phase 9 checks.

Gate: browser/RPC/log fixtures have no secrets; ACL and ownership-selection logic exclude unrelated objects; journal transitions are total; all pages have empty/loading/error states. Real network mutation and reboot recovery are deferred.

### Phase 8 — Build and release automation

Complete lightweight PR/push CI, a dedicated Release validation workflow, reusable OpenWrt 24.10 IPK and 25.12 APK SDK compilation, script-version gates, artifact metadata checks, checksums, changelog validation, and approved GitHub Releases. Snapshot builds remain non-blocking.

**Pre-phase investigation**

1. Identify supported SDK targets/architectures, runner images, package dependencies, artifact naming, current tag/version conventions, and repository GitHub permissions.
2. Separate shell-only publication from package release: determine which paths require script API/version bump, package version/release bump, both, or neither.
3. Define RC/stable tag policy, reproducibility data, checksum format, changelog sections, provenance, permissions, concurrency, and approval environments.

**Detailed tasks and ownership**

- CI implementation subagent owns PR/lint/unit workflows and reusable SDK build workflow.
- Release implementation subagent owns version/checksum/changelog/release workflows and does not publish anything.
- Test subagent owns workflow static checks, read-only artifact inspection scripts, pure version-matrix expected failures, and compile evidence. It does not simulate install/uninstall/upgrade/downgrade.
- Ordinary CI runs the bounded offline compile/static/pure-logic command, secret scanning, scope classification, and the shell-only version/API gate. Package-scope changes then invoke the canonical checksum-pinned SDK matrix; shell-only and documentation changes skip it.
- Manually dispatched Release validation requires an exact tag and base ref, reruns the ordinary code gate plus package-scope/version checks, and then invokes the same canonical 24.10.8 IPK/r and 25.12.5 APK/r matrix.
- The reusable build copies the checksum-pinned 25.12 SDK's static host `apk` reader only as a verification aid. It is excluded from the release bundle; the bundle contains exactly one IPK, one APK, notes, and checksums.
- Release checks require tag/Makefile/script metadata/changelog/artifact names/checksums to agree; RC is `v3.0.0-rc.1` and stable is `v3.0.0`.
- Shell-only changes validate and may update only the fixed Raw script on `main`; they do not claim an IPK/APK update. Package/API changes require the full release gate.
- Publishing, branch push, tags, GitHub environments, and Releases are manual-authority operations. Workflows may be created and tested but are never dispatched/published unattended.

**Acceptance and verification**

- Local/static workflow validation and both representative SDK compilations pass; artifact inspection verifies declared files, modes encoded in the archives, dependencies, versions, lifecycle embedding, and checksums without installing the package.
- Supported SDK builds use reproducibly identified cached SDK inputs or safely downloaded SDKs. If a required SDK cannot be obtained or executed after bounded retries, Phase 8 is `blocked`; this is not a `DEFERRED-MANUAL` gate item.
- Artifact inspection proves file list/modes/dependencies/versions and checksums; intentionally mismatched metadata fails.

Gate: the 24.10 IPK and 25.12 APK compile; read-only artifact metadata, tag, source/APK version projection, Makefile, checksums, lifecycle embedding, and notes agree; shell-only changes pass their dedicated compile/static/logic gate without requiring a package release or SDK build. Install behavior remains Phase 9 manual coverage.

### Phase 9 — RC device acceptance

Test fresh install, stock/custom upgrade, service-state preservation, single/multiple instances, PC/mobile classification, IPv4/IPv6, failures, logout delay, Raw update/rollback, Custom preservation, reboot recovery, network journal recovery, and the supported v2 downgrade.

**Pre-phase investigation**

1. Prepare an operator checklist with device model/OpenWrt/mwan3 versions, backup/restore steps, isolated test accounts, WAN mapping, evidence paths, abort thresholds, and rollback commands.
2. Reconcile every `DEFERRED-MANUAL` platform/integration item from Phases 2–8, especially portal/device execution, opkg lifecycle, service restoration, update activation/rollback, network ownership/recovery, and installed artifact behavior; no item may disappear from the checklist.
3. Verify RC artifact/checksum/signature offline and require explicit approval for install, network mutation, portal actions, reboot, downgrade, push/tag/release, and credential use.

**Detailed tasks and ownership**

- Main agent prepares the checklist, evidence template, command-by-command safety review, and read-only preflight. It does not act on a real device without approval.
- Test subagent reviews coverage and acceptance thresholds against earlier contracts and failure modes.
- After approval, an implementation/operator agent may execute only the specifically authorized device steps, stopping on secret leakage, unexpected object ownership, repeated login attempts, rollback failure, or loss of management access.
- Review subagent audits retained redacted evidence and defects; product owner decides subjective UX and stable release readiness.

**Acceptance and verification**

- Every matrix cell records environment, precondition, action, expected/actual result, timestamp, redacted evidence, cleanup, and defect link.
- Every `DEFERRED-MANUAL` item reconciled from Phases 2–8 must be executed and record `PASS`. A skipped, untested, or failed required integration cell blocks RC acceptance unless the user first approves an explicit plan/contract change removing that requirement.
- Soak monitoring has explicit duration, retry-storm threshold, secret scan, service/resource health checks, and rollback verification.
- No stable tag/release is created until the user accepts device evidence and explicitly authorizes publication.

Gate: every deferred integration cell passes, and the RC completes the soak period without login storms, secret leaks, P0/P1 defects, migration loss, or failed rollback. Then publish `v3.0.0`.

Gate interpretation: the Phase 9 gate ends at documented RC acceptance. The original “Then publish” sentence describes the next release action, not pre-authorization; pushing, tagging, or publishing `v3.0.0` occurs only after a separate explicit user authorization.

## Human-intervention boundary

The unattended executor must stop before, but only before, the following actions. It should first finish every remaining offline/reversible task and provide exact commands/checklists:

- using a real account/password or retrieving credentials from a router/browser/capture;
- real portal login, logout, unbind, or any request intended to change authentication state;
- installing, removing, upgrading, or downgrading an IPK or APK on a real device;
- changing or reloading a real device's network, firewall, mwan3, DHCP, routing, service state, or rebooting it;
- executing validation/self-test for, or activating, a downloaded/custom script on a real device;
- choosing unresolved product behavior or accepting subjective UX/visual results;
- pushing a branch, opening/merging a PR, creating a tag, dispatching a privileged workflow, or publishing a GitHub Release;
- destructive cleanup outside a test root or any step that risks losing management access.

Allowed unattended work includes local branches/commits, compile/lint/static analysis, redacted protocol fixtures, pure-logic unit tests, narrow argv/stdin capture stubs, SDK compilation, read-only artifact inspection, source downloads/build caches that do not mutate external services, and read-only repository inspection. Simulated router rootfs/package/service/network/reboot behavior and local HTTP emulation are not part of unattended acceptance. Even real read-only portal/device checks are deferred to Phase 9.

## Decision log

| ID | Decision | Reason | Phase |
| --- | --- | --- | --- |
| D-001 | Keep scheduling/backoff in package-managed `login_control.bash`. | Remote shell updates must not change product scheduling or multi-instance policy. | Fixed |
| D-002 | Update only unified `cqu-portal.sh` from the fixed Raw URL. | Shell protocol fixes can ship independently without turning Raw into a package updater. | Fixed |
| D-003 | Use staged validation, explicit activation, LKG, and automatic rollback. | Remote/custom root code must never overwrite the active script directly. | Fixed |
| D-004 | Use redacted protocol fixtures and host-independent logic inputs through Phase 8; defer all real device/portal checks. | Current authorization explicitly prohibits real portal and device mutation. | All |
| D-005 | Preserve the exponential-backoff policy but harden its implementation and add bounded jitter. | Existing product behavior remains recognizable while preventing unsafe argv/eval/temp handling and synchronized retries. | 3 |
| D-006 | Treat `ok` as a trustworthy action result rather than “online”; offline status and already-online are non-error outcomes despite exits 1/2. | Exit codes preserve CLI state semantics while JSON can distinguish valid state from auth/transport failure. | 2 |
| D-007 | Preserve non-empty account usernames end to end, including spaces and UTF-8, while rejecting control characters at the action boundary. | The frozen UCI contract defines username as a preserved non-empty string; identifier-only validation silently broke valid legacy data. | 3 |
| D-008 | Portal argument parsing uses shell builtins only until production PATH sanitization and dependency checks complete. | Ambient executables must not cross the pre-validation trust boundary or change dependency failures into argument failures. | 3 |
| D-009 | Install the portal core as a package-owned factory copy; initialize but do not package-own the active `/etc` copy. | Later package upgrades must not overwrite a validated Raw/Custom active script, while fresh install and restore still have an immutable factory source. | 4 |
| D-010 | Limit unattended gates to compile/static/artifact checks and pure product logic; do not emulate OpenWrt, opkg, services, router rootfs, network state, or reboot. | High-fidelity host simulation costs more than it proves; end-to-end platform behavior belongs on the real Phase 9 device matrix. | All |
| D-011 | Standard action-envelope `code` remains a string; the legacy numeric action exit moves to `legacy_code` and `data.exit_code`. | JSON cannot carry both authoritative string and integer values under the same top-level key; cached v2 LuCI only displays the field and remains renderable. | 5 |
| D-012 | Phase 7 owns only IDs recorded in `network-state.json`; unrecorded legacy `auto_*` objects are never adopted or deleted by prefix. | A conservative migration may leave legacy objects for manual cleanup, but cannot destroy unrelated user configuration. | 7 |
| D-013 | Configuration saves never restart the service implicitly; applying runtime changes uses the fixed `service_action` method. | Service mutation must be explicit, object-scoped, and independently reportable instead of being hidden behind form persistence. | 7 |
| D-014 | Keep `PKG_RELEASE:=1` and accept the SDK-native control versions `3.0.0-rc.1-1` on 23.05 and `3.0.0-rc.1-r1` on 24.10; publish both distinctly named `all` artifacts. | The supported OpenWrt lines encode the same release value differently, so cross-SDK byte/name equality is neither achievable nor a valid compatibility assertion. | 8 |
| D-015 | Diff-aware CI skips SDK compilation for Raw shell-only changes, but requires `cqu-portal.sh` SemVer to increase while API 3 remains unchanged. | A protocol script can update independently without claiming an IPK release, while an API change still requires the package gate. | 8 |
| D-016 | Ordinary CI never compiles SDK packages; a manually dispatched Release validation gate compiles 23.05/24.10 IPKs and a 25.12 APK before the protected draft workflow can consume their exact-SHA artifacts. | Package compilation is release evidence rather than useful feedback on every push, while exact provenance still prevents an unchecked artifact from being published. | 8 extension |
| D-017 | Preserve SemVer `3.0.0-rc.1` for source/tag/script/changelog and project it deterministically to APK version `3.0.0_rc1`; use package-manager-native filenames and exclude QEMU from acceptance. | apk-tools v3 rejects the SemVer prerelease spelling, and QEMU would not establish the real mwan3, service, migration, or portal behavior that Phase 9 must verify. | 8 extension / 9 |
| D-018 | Supersede D-014/D-016 build-matrix assumptions: package-scope CI and manual Release validation both compile only 24.10.8 IPK/r and 25.12.5 APK/r from one reusable matrix; shell-only/docs skip SDKs, and the release bundle contains one IPK plus one APK. | The package is architecture-independent (`all`/`noarch`), so x86_64 SDK builds witness package-format boundaries rather than CPU targets; 23.05 IPK duplicates the 24.10 IPK signal and remains a manual compatibility concern rather than a CI/release artifact. | 8 amendment |
| D-019 | Do not require the optional `stat`/`busybox stat` applet on a target device; use a fail-closed `ls -ldn`/awk fallback for package migration, script/config metadata checks, diagnostics, and the downgrade finalizer. | A real device running v2.2.0-4 has neither command, causing the first v3 pre-install legacy snapshot to abort before unpack. Requiring an additional package would make migration depend on feed availability and still leave a fragile implicit runtime dependency. | 9 regression fix |
| D-020 | Initialize JSHN's `JSON_PREFIX` before sourcing it in every `set -u` RPC helper, and make postinst best-effort restart rpcd once migration is complete, including repeat postinst calls. | A real v3 device showed the fresh `rpcd exec` helper process has no `JSON_PREFIX`; JSHN then exits before returning any RPC response. rpcd also retains the old handler method list until restart. The restart must not abort an otherwise completed package upgrade. | 9 regression follow-up; superseded by D-021 for JSHN handling |
| D-021 | Do not run the third-party JSHN library under global `set -u`; remove backend state shims and custom `json_init` overrides; retain explicit empty optional arguments at the application boundary; validate `jshn -r` status before native `json_load`; and gate the contract with the real SDK JSHN plus BusyBox ash. | JSHN dynamically expands unset variables in normal missing-field paths, turning expected lookup failures into `No response` under nounset, while its shell `json_load` wrapper can swallow parser failures for malformed brace-delimited text. Incremental variable initialization/overrides only chased the next crash and did not provide a reliable JSON envelope. Native JSHN semantics plus narrow caller-side status validation are the smallest fail-closed fix; ucode remains a later architectural option. | 9 regression follow-up (r6) |
| D-022 | Treat LuCI 23.05 compatibility aliases as titleless routes, declare `expect: { '': {} }` for every frontend RPC, invalidate the generated menu index after a live upgrade, and filter nullish DOM children before legacy LuCI appenders receive them. | Device evidence showed duplicate tabs from title-bearing aliases and literal `null`/`nullnull` text from LuCI 23.05's array appender; stale menu/RPC rendering persisted across upgrades. These are frontend/cache compatibility defects and do not change the fixed RPC or backend contracts. | 9 regression follow-up (r7) |
| D-023 | Treat rpcd's non-business `ubus_rpc_session` parameter as trusted transport metadata: require a non-empty string and remove it before exact business-field validation in both shell backends. | LuCI requests appear as `{}` in the browser, but rpcd injects `ubus_rpc_session` before invoking shell handlers. Rejecting that field caused real LuCI pages to show `invalid request fields`/`invalid request` while direct `ubus call` remained green. Unknown client fields remain rejected. | 9 regression follow-up (r8) |
| D-024 | Boolean HTML attributes passed through LuCI `E()` must be omitted when false; map disabled state to `disabled` or `null` instead of passing `false`. | LuCI 23.05 serializes non-null attributes with `setAttribute()`, so `disabled="false"` still disables every button and editor. Busy/recovery state remains the only source of actual disabling. | 9 regression follow-up (r9) |
| D-025 | Enumerate MultiLogin sections with `uci -X show` and capture the listing before parsing. | Default UCI output renders anonymous sections as `@type[index]`, which the backend token grammar deliberately rejects; `-X` exposes generated names for legacy anonymous readback while enumeration failures fail closed. New writes and legacy normalization must use named sections for durable references. | 9 regression follow-up |
| D-026 | Create new account/instance sections with deterministic unused names (`account_N`/`instance_N`), and normalize legacy generated `cfg...` sections before edits or references, naming affected instances before rewriting their account links in the same locked UCI transaction. | UCI generated names hash type/options and can change after an anonymous section is edited or reloaded; storing them as instance references can orphan a link. Named sections preserve stable references without renaming existing non-generated user sections. | 9 regression follow-up |
| D-027 | Treat r10's controller enumeration, portal local-failure classification, and candidate-document identity as release-blocking contract surfaces, and keep generated Playwright/Node files out of the package source. | The independent Sol audit found that anonymous enabled instances could be skipped, local portal failures could violate the RPC outcome/error-kind pairing, and operator documents could name obsolete artifacts; the corresponding regressions are now covered while local test dependencies remain ignored. | 9 regression follow-up (r10 audit) |
| D-028 | Reject CR/LF in account text with a sentinel-preserved newline rather than a command-substituted empty pattern, and execute the validator as pure logic. | QEMU LuCI testing of r10 showed `ml_valid_text()` rejected every ordinary alias before section allocation, so `save_account` returned `invalid_request` without a UCI write. A static-only assertion was insufficient; r11 adds executable ASCII/UTF-8/control/length coverage and bumps the package revision. | 9 regression follow-up (r11 validator) |
| D-029 | Put BusyBox awk section filters inside explicit action blocks rather than relying on a bare `!~` pattern action. | QEMU r11 instance creation reached the anonymous/named-section detector, where BusyBox awk rejected the POSIX-looking bare pattern with `Unexpected token`; the locked transaction rolled back before any instance write. | 9 regression follow-up (r12 awk compatibility) |
| D-030 | Make removal of an absent optional `v6face` UCI option idempotent. | QEMU r12 reached all instance `uci set` operations, then `uci -q delete` returned nonzero for the blank optional field and the outer failure guard reverted the transaction. | 9 regression follow-up (r13 optional field) |
| D-031 | Ignore only UCI's explicit missing-option status when clearing blank `v6face`; propagate read/delete errors into transaction rollback. | Sol's second review found r13's unconditional `|| :` could leave an existing IPv6 option while reporting success if deletion failed. r14 distinguishes status 1 (absent) from all other failures. | 9 regression follow-up (r14 fail-closed optional field) |
| D-032 | Determine `v6face` presence from a successful exact section listing before deleting; do not infer missing-vs-error solely from `uci get` exit status. | Sol's review noted that target `uci` implementations may map different libuci failures to the same status. r15 treats a missing option as a no-op, but requires section read, exact presence detection, and delete success; all other paths roll back. | 9 regression follow-up (r15 exact optional field) |
| D-033 | Anchor optional `v6face` detection to the beginning of a complete UCI option line. | Sol reproduced r15's unanchored fixed-string match against a legal alias containing `multilogin.instance_1.v6face=`; r16 adds an anchored regex and an adversarial pure predicate. | 9 regression follow-up (r16 anchored optional field) |
| D-034 | Keep the visual refresh in a shared theme-aware stylesheet and native LuCI `E()` structures, with no changes to RPC methods, ACLs, UCI schema, service actions, or portal boundaries. | The five pages need a consistent hierarchy and responsive states while retaining the tested persistence/security contract; browser-specific visual acceptance remains a Phase 9 product-owner decision. | 9 regression follow-up (r17 UI) |
| D-035 | Keep four top-level task destinations, but make both maintenance tasks permanently discoverable through an in-page keyboard-accessible sub-navigation; require an explicit danger confirmation before `network_recover`. | Sol's r18 UI review found the scripts page unreachable through normal navigation and a recovery button whose label understated UCI commits and network/firewall/mwan3 reloads. The r18 follow-up adds visible two-way maintenance links, a destructive confirmation, and a single dashboard start affordance without changing RPC/UCI/ACL/service/portal contracts. | 9 regression follow-up (r18 UI safety) |
| D-036 | Make r19 dashboard and managed-script maintenance decision-first: show only overall conclusion and blocker warnings, treat absent network resources as non-blocking, keep the five explicit service actions in the blocker card, and reduce managed updates to one confirmed check-and-update plus built-in restore. | Product review found configuration completeness, recovery reminders, fingerprint/version metadata, candidate stages, previous-version rollback details, and long update choreography distracted from the actions users need. Internal validation and rollback contracts remain unchanged; LuCI 23.05 optional children must still be filtered to avoid literal `null`. | 9 regression follow-up (r19 product convergence) |

## Progress log

| Phase | State | Evidence / commit | Review | Decisions / remaining risks |
| --- | --- | --- | --- | --- |
| 9 regression follow-up (r18 UI safety) | accepted (automated) | 2026-08-03T06:15:25+08:00; baseline `78c4346`; main agent plus Luna follow-up workers and independent Sol advisor. Kept the four-destination IA while making the maintenance sub-navigation always visible and bidirectional on desktop/mobile; filtered the duplicate dashboard start action; changed network recovery to an explicit destructive confirmation naming UCI write/commit and network/firewall/mwan3 reload. Phase 7 `16/16`, Phase 6 `8/8`, full `CI=0 timeout 60s ./tests/run.sh` `16` checks with four optional-tool skips, all LuCI `node --check`, JSON validation, version matrix, and `git diff --check` passed. Clean 24.10.8 SDK build: `luci-app-multilogin_3.0.0-rc.1-r18_all.ipk`, SHA-256 `35aed4d49e055895dbb5186635ca7f7d0478ca0e704b4bd6f804d590cb34291e`; read-only payload inspection confirmed the fixes. Disposable QEMU force-reinstalled the package; Playwright evidence covers 1440px/390px headings, no overflow, read-only RPCs, visible two-way maintenance links with correct `aria-current`, and no forbidden writes. An offline recovery fixture confirmed canceling the danger modal made zero `network_recover` calls; account readback remained `account_1`/`offline-ui-check`, password was not rendered, auto-login stayed disabled, no login task or Portal request was created. | Independent Sol follow-up reviewer `/root/sol_r18_ui_review`: `PASS`; prior P1 findings are closed. | D-035 applies. 25.12 APK build, real-device install/upgrade/downgrade/service/network/portal cells, and publication remain Phase 9 `DEFERRED-MANUAL`; QEMU is a disposable regression smoke, not platform acceptance. |
| 9 regression follow-up (r19 product convergence) | accepted (automated) | 2026-08-03T11:02:40+08:00; baseline `b4e5ed6`; main agent plus Luna static/artifact/gate workers. Dashboard now renders only overall conclusion and blocker warning cards; missing network resources no longer block; all five service actions remain explicit and confirmed. Managed update is one confirmation followed internally by check/stage/validate/activate with no automatic downgrade; UI keeps only built-in restore and custom draft editing, with internal hashes/generations/rollback RPCs hidden. Added a LuCI 23.05 `compact()` guard for the built-in-script empty state after QEMU exposed a literal `null`. Focused Phase 6 `8/8`, Phase 7 `16/16`, full runner `16` with four optional-tool skips, controller `19/19`, portal `9/9`, version matrix, JSON/syntax/diff checks, clean 24.10.8 SDK build, read-only IPK inspection, and final QEMU/Playwright smoke passed. Candidate: `luci-app-multilogin_3.0.0-rc.1-r19_all.ipk`, SHA-256 `eff0fdf02ccb13b70387798c149100235f5f7fa0c0467be41305f69ab8fa0281`. Disposable QEMU force-installed r19; Playwright evidence in `/tmp/multilogin-qemu-r10/screenshots/r19-ui-evidence.json` covers 1440px/390px overview and script screenshots, no horizontal overflow, all five `service_action` payloads, cancel paths with zero mutator/update/restore calls, no Portal requests, no literal `null` text, and package readback with global auto-login disabled and zero instances. | Independent Sol `/root/sol_r18_ui_review`: `PASS`; no P0/P1. P2 only: one discarded full-page confirmation capture was visually poor, and one global bootstrap `uci/get` permission warning is outside route-level evidence. | D-036 applies. 25.12 APK, real-device package/service/network/portal/script cells, publication, and subjective product-owner acceptance remain Phase 9 `DEFERRED-MANUAL`; QEMU is a disposable package/UI smoke only. |
| Plan | accepted | Repository, portal profile, and existing plan inspected on 2026-07-31. Initial review returned `BLOCK`; four gate/durability ambiguities were corrected. | Independent reviewer `/root/plan_review`: `PASS`. | Plan is tracked and committed before Phase 0. |
| Plan scope | accepted | 2026-08-01 user-directed validation reduction: unattended gates now contain only compile/static/artifact checks, pure product logic, and narrow stdin/argv security stubs; the default runner must exclude platform simulations and stay within a 60-second non-SDK budget. | Terra `/root/phase3_controller` first returned `BLOCK` for three residual process/mock/manual-gate contradictions; all were corrected and rereview returned `PASS`. | D-010 added. Every platform integration claim is deferred to Phase 9 and every deferred matrix item must pass before RC acceptance. |
| 0 | accepted | 2026-07-31; main agent, `/root/phase0_baseline`, `/root/phase0_audit`; accepted content commit `b4fe21e66d0337839788e75e8392f77e922f329d`. Checks passed: shell/Bash/JS syntax, JSON, two byte-identical baseline reproductions, stock-script equality, contract UCI/RPC/exit coverage, secret-placeholder scan, and `git diff --check`. | Test/audit final `PASS`; independent reviewer `/root/phase0_review` found and verified the Phase 3 rpcd-launcher ordering fix, then returned `PASS`. | ShellCheck and BusyBox unavailable locally; mandatory in Phase 1 CI. Real device/portal actions and candidate root-code validation remain Phase 9 manual items. |
| 1 | accepted | 2026-07-31; main agent, `/root/phase1_tests`, `/root/phase1_ci`; accepted content commit `f0ebfe2e88181178edfef682a9f977e36f7dfc77`. Local `14 PASS/3 SKIP`; required BusyBox/ShellCheck/shfmt mode final `18 PASS/0 SKIP`; missing-tool CI negative, intentional bad cases, workflow full-history/pins/permissions, and diff checks passed. | `/root/phase1_review` blocked shallow checkout and incomplete future lint scope; fixes were rerun and reviewer returned `PASS`. | Historical mocks remain evidence for accepted phases but must not be expanded into OpenWrt/platform emulation after D-010. All shell files changed from the v2 baseline automatically enter lint. |
| 2 | accepted | 2026-07-31; `/root/phase2_script` and Luna `/root/phase2_tests_luna`; accepted content commit `8b31696fd78857b6ff63f04d1c09082a9e70c560`. Direct offline version/self-test and required BusyBox/ShellCheck/shfmt runner passed (`19 PASS/0 SKIP`); portal groups cover strict CLI, PC/mobile, exact config/UA, stdin secret framing, ret-code race, classification, IPv4/IPv6, logout precedence/bounds, identity ambiguity, signals, and concurrency. | Independent Terra reviewer `/root/phase2_review`: `PASS`. | Real read-only status/login/logout remain `DEFERRED-MANUAL` to Phase 9; no real portal/device action occurred. |
| 3 | accepted | 2026-07-31–2026-08-01; main agent, controller/RPC implementation agents, Luna test agents; accepted content commit `00758c789812ac7ab196a4658062fe063cc985ac`. Changed the package controller, unified-script account validation, three rpcd action launchers, unsafe-pattern allowlist/runner, and offline portal/controller/RPC tests. Required command `PATH=/tmp/multilogin-phase1-tools.pcM2io/root/usr/bin:$PATH CI=1 MULTILOGIN_REQUIRE_TOOLING=1 ./tests/run.sh` passed `21/21`, `0` skips; sub-suites passed portal `9`, controller `18`, and executable RPC `13`. Timing evidence covers exact `8/16/32`, no early retry, cap-before-jitter at `15/17`, success/interface reset, and multi-instance isolation; syntax/lint/format/safety/baseline/expected-failure/signal/secret/diff checks passed. | Terra `/root/phase3_review` first returned `BLOCK` for ambient `awk` before PATH/dependency validation. D-008 plus BusyBox/empty-PATH regression resolved it; rereview returned `PASS` and confirmed no code-testable gate was deferred. | D-007/D-008 added. Real portal/device checks remain `DEFERRED-MANUAL` to Phase 9; no real credential, portal, service, network, or device action occurred. |
| 4 | accepted | 2026-08-01; baseline `06453b5`; main agent, Terra production workers/reviewers, and Luna test workers; accepted content commit `f18e113`. Implemented factory/active ownership, secret-free fresh config, three compatibility wrappers, embedded lifecycle hooks, and migration/downgrade source logic. D-010 discarded uncommitted rootfs/opkg/service simulation tests and removed test-root/fake-disk/fake-service/failpoint branches from business code. Required bounded command with BusyBox/ShellCheck/shfmt on `PATH`, `CI=1 MULTILOGIN_REQUIRE_TOOLING=1 ./tests/run.sh`, passed `15/15`, zero skips in about 2 seconds; Phase 4 static/pure checks passed `5/5`; diff/static no-simulation checks passed. | Earlier reviews found downgrade-stop, lock, pinned-hash, checked-transaction, and archive-validation source defects. After fixes and the D-010 gate reduction, independent Terra `/root/phase3_controller` reran the allowed gate and returned `PASS` without claiming platform integration coverage. | D-009/D-010 added. Real opkg hook order/embedding, conffile bytes/modes, service restoration, overlay locking/atomicity, interruption/reboot recovery, fresh/upgrade/remove/downgrade, and finalizer execution are mandatory Phase 9 `PASS` items. |
| 5 | accepted | 2026-08-01 through 2026-08-01T07:20:16+08:00; baseline `9b33399`; main agent, Terra `/root/phase3_controller`, and Luna `/root/phase2_tests`; accepted content commit `75e74bcf9c1d787e90d76760dfb8f6cd75e500cb`. Implemented the fixed Raw/Custom backend, pure policy library, RPC dispatch, D-011 action envelope, activation journal/LKG recovery, and init recovery ordering. Required bounded command `PATH=/tmp/multilogin-phase1-tools.pcM2io/root/usr/bin:$PATH CI=1 MULTILOGIN_REQUIRE_TOOLING=1 timeout 60s ./tests/run.sh` passed `16/16`, zero skips in 3.1 seconds; Phase 5 static/pure checks passed `9/9`, including exact schemas, SemVer/input policy, source exposure, post-execution hash checks, and state-first LKG recovery ordering. | Contract review passed after corrections. Independent read-only Terra `/root/phase5_review` reran the allowed Gate (`16/16`, zero skips in 3.2 seconds), verified security/compatibility/transaction ordering, and returned `PASS`; earlier fail-open durable slots and pre-state LKG rotation were corrected before final review. | D-010/D-011 apply. The required runner contains no portal/controller/RPC/backend execution and no OpenWrt, rootfs, opkg, service, UCI, mwan3, network, reboot, local-HTTP, activation, or recovery simulation. Real download, validation/activation/rollback, lock/JSHN behavior, filesystem atomicity/recovery, status selection, and device behavior remain mandatory Phase 9 checks. |
| 6 | accepted | 2026-08-01T09:49:51+08:00 through 2026-08-01T10:20:40+08:00; baseline `ac2ebf3`; main agent, Terra `/root/phase6_ui`, and Luna `/root/phase2_tests`; accepted content commit `f5ba4f91db4c13a4279ecf98e3edf74460e0327f`. Replaced direct script file/template/service operations with the ten fixed Phase 5 RPCs and Managed/Custom state flows. Main review corrected check-result loss, base-hash advancement on conflict, unsaved-text loss, recovery/error precedence, displayed-versus-saved root-code mismatch, sticky conflict actions, and failed Reload unlocking. Required bounded command `PATH=/tmp/multilogin-phase1-tools.pcM2io/root/usr/bin:$PATH CI=1 MULTILOGIN_REQUIRE_TOOLING=1 timeout 60s ./tests/run.sh` passed `17/17`, zero skips in 3.2 seconds; Phase 6 checks passed `8/8`. | Independent read-only Terra `/root/phase6_review` reran the Gate and returned `PASS`. Its initial `BLOCK` cited known Phase 7 UCI/action ACL work; after enforcing the one-phase boundary it confirmed no Phase 6 defect and recorded those grants as Phase 7 risks. | `ui-ux-pro-max` produced a content-first baseline; implementation kept native LuCI theme semantics, visible feedback/focus, 44px controls, flex wrapping, static 375px containment, and Chinese product language. The Gate only compiles and inspects source/JSON plus extracted pure predicates; it uses no DOM, browser, RPC, OpenWrt, filesystem, service, network, or viewport simulation. Real rendering, keyboard/focus flow, contrast, responsive layout, and router RPC behavior remain manual. |
| 7 | accepted | 2026-08-01T10:26:24+08:00 through 2026-08-01T12:59:16+08:00; baseline `c9ac3ad`, contract commit `45cd3a1`, accepted content commit `d087d506212a0e09398a2e086c8cfe175c820428`; main agent, Terra UI/backend agents, Luna test agent, and independent Terra reviewer. Added the fixed configuration/diagnostics/network backend and pure policy, stdin-only password UCI writes, exact ownership/journal/recovery source, strict RPC adapter and ACL, five-route LuCI product, credential-free docs, and Phase 7 static/pure tests. Required command `PATH=/tmp/multilogin-phase1-tools.pcM2io/root/usr/bin:$PATH CI=1 MULTILOGIN_REQUIRE_TOOLING=1 timeout 60s ./tests/run.sh` passed `18/18`, zero skips; Phase 7 passed `10/10`; shell/BusyBox/ShellCheck/shfmt/JS/JSON/safety/baseline/expected-failure/diff checks passed. | Contract review passed after three correction rounds. Independent `/root/phase7_review` first returned `BLOCK` for owned UCI line-count convergence, reload rollback, log truncation accounting, and envelope compatibility; fixes and regression assertions landed, exact Gate reran, and final verdict was `PASS`. | D-010/D-012/D-013 apply. Actual UCI writes/commits, rpcd/JSHN behavior, service actions/reloads, log file races, ownership drift/recovery across reboot, router connectivity, and browser/keyboard/375px rendering remain `DEFERRED-MANUAL` to Phase 9; no platform behavior was simulated. |
| 8 | accepted | 2026-08-01T13:08:00+08:00 through 2026-08-01T14:09:50+08:00; baseline `bca5117`, accepted content commit `bdf3a568eb9a4075eea518effcf37d4c190c272f`; main agent, Terra CI/release agents, Luna test agent, and independent Terra reviewer. Added diff-aware offline/shell/package CI, reusable pinned SDK builds, protected manual draft-release workflow, `v3.0.0-rc.1` package/changelog metadata, pure scope/version/notes gates, and fail-closed read-only IPK inspection. Exact non-SDK gate `PATH=/tmp/multilogin-phase1-tools.pcM2io/root/usr/bin:$PATH CI=1 MULTILOGIN_REQUIRE_TOOLING=1 timeout 60s ./tests/run.sh` passed `19/19`, zero skips; Phase 8 passed `6/6`; real source matrix `node tools/release/version-matrix.mjs --tag v3.0.0-rc.1` passed; workflow YAML parsed locally. Official x86_64 SDK archives matched SHA-256 `f22bdac5b702bb823a0ee802e9bbda2a56c0f7a2687e5090113b00910dac995f` (23.05.6) and `ac4a0405d2eea821b06f93c14ba13ffa90ad0457648903df7dde02570027ab21` (24.10.8). After `umask 022; make defconfig`, both `make package/luci-app-multilogin/compile V=s` builds passed. Exact-manifest inspection passed for `luci-app-multilogin_3.0.0-rc.1-1_all.ipk` SHA-256 `9f18fefe33e97c4578c570089780743fdccabf38ea141835b7ea83d71686dee4` and `luci-app-multilogin_3.0.0-rc.1-r1_all.ipk` SHA-256 `2755118e16ff70795129241f93e058baa1088b30f538b585c48b1275358c8cb6`. | `/root/phase8_review` initially returned `BLOCK` for the absent shell-only version gate, presence-only artifact allowlist, and incomplete Actions-run provenance. Diff-aware SemVer/API gating, exact dependency/payload rejection, and workflow/event/repository/branch/SHA provenance checks resolved all findings; the reviewer reran `19/19`, confirmed focused `6/6`, and returned `PASS`. | D-014/D-015 added. GitHub feed TLS failures were bounded locally; both official SDKs still compiled this no-build-dependency `all` package and exact control dependencies were inspected. The checked-in workflow performs the full feed integration but was not dispatched. Push, environment configuration, workflow dispatch, tag, draft/stable Release, real IPK install/upgrade/remove, and installed/runtime behavior remain manual-authority items; package/device integration is `DEFERRED-MANUAL` to Phase 9. |
| 8 extension | accepted | 2026-08-01; baseline `7506d21`; main agent, Terra `/root/release_check_workflows`, Terra `/root/phase7_backend`, and independent Terra `/root/phase8_release`. Removed SDK compilation from ordinary CI; added manual tag/base-ref Release validation; extended the pinned SDK/build/inspection/release chain to 23.05.6 IPK/plain, 24.10.8 IPK/r, and 25.12.5 APK/r. Split source SemVer `3.0.0-rc.1` from APK projection `3.0.0_rc1`; corrected Make hook expansion for APK while preserving both IPK builds. Required gate passed `19/19`, zero skips; focused Phase 8 passed `7/7` with negative metadata/dependency/payload/mode/checksum and marker-only/literal/extra-prefix/duplicate-hook cases; all workflow YAML parsed and `git diff --check` passed. Clean real SDK rebuilds and exact read-only inspection passed for IPK23 SHA-256 `9f324884fad024a067c6116e69c7e809dc3c37186d2bf5a22145b584f79274f4`, IPK24 `f654f0655f1781822d391186a1bc663cd06f8a12acb4bd9529433b10120c9671`, and APK25 `cf35d9b4f6e364a70a19502a3a338ea3fbd4236a3618f1ec6db02b54cc6e0092`. | Reviewer twice returned `BLOCK`: first for marker-only/no IPK hook verification, then for ignored APK pre-marker/duplicate content. Exact per-hook IPK byte comparison and exact unique full APK wrapper+embedded-body comparison resolved both; final verdict `PASS`. | D-016/D-017 added. QEMU is intentionally skipped. The static SDK `apk` reader is a verification aid and is not released. No workflow was dispatched and no package was installed; 25.12 APK real-device `PKG-02A`, all prior Phase 9 device cells, push/tag/draft/stable Release, and signing decisions remain manual-authority items. |
| 8 CI amendment | accepted | 2026-08-01; baseline `8befffb`; main agent and Terra `/root/release_check_workflows`. Fixed the SDK SHA-256 validator by separating lowercase-hex and exact-length checks; centralized a two-entry 24.10.8 IPK/r plus 25.12.5 APK/r matrix; package-scope CI and manual Release validation now invoke it; release inspection requires exactly one IPK and one APK. Focused Phase 8 passed `7/7`; required bounded gate passed `19/19`, zero skips; version matrix, all workflow YAML parses, and `git diff --check` passed. | Independent read-only Terra `/root/phase8_release`: `PASS`; confirmed reusable-workflow semantics, scope gating, two-format matrix, provenance, and checksum policy. | D-018 added and supersedes D-014/D-016 only for current build/release-matrix policy. The GitHub SDK jobs themselves remain to be run by this branch's package-scope CI; no QEMU, package install, device action, tag, or Release was performed locally. |
| 9 | blocked | Offline preparation ran 2026-08-01T14:12:00+08:00 through 2026-08-01T14:34:34+08:00 from baseline `51d78eb`; preparation commit `9e6b0811eae5773aa25d84e29292a464c55ee10f`; no device or portal was contacted. Added `docs/v3/rc-device-acceptance.md` with per-scope authorization, evidence/secret rules, exact abort thresholds and cleanup templates, mandatory 23.05/24.10 package/portal/controller/RPC/script/config/network/UI cells, IPv4-only/dual-stack variants, fixed v2 downgrade/finalizer, lock/atomicity/fault/reboot coverage, post-device GitHub gates, and independent 24-hour soak windows. Rebuilt the pinned downgrade source `fb272e8285c65415dea8a9a359a4204b94be06a0` in the checksum-verified official 23.05.6 SDK with `umask 022; make defconfig; make package/luci-app-multilogin/compile V=s`; `luci-app-multilogin_2.2.0-4_all.ipk` was produced with SHA-256 `bd3de0f4dfbd13a9bd84ab8f63f9875dcd99c232ad23a53d9009dba5dc2f4f1e` and read-only control metadata `Version: 2.2.0-4`, `Architecture: all`. Required repository gate reran `19/19`, zero skips; `git diff --check` passed. | Luna `/root/phase7_tests` initially blocked missing config authorization, IP-family/dual-line assignment, script concurrency/low-space, contrast, cleanup, GitHub classification, and safe credential sequence details. All coverage gaps were added; two follow-up reviews hardened signal/EOF/empty and non-TTY/stty failure handling. Final verdict `PASS`, with no simulation or unsafe evidence path. | No safe automated Phase 9 integration work remains. Required blockers are explicit device inventory and out-of-band recovery, approved isolated credentials/WAN mapping, scoped approvals for package/service/portal/root-code/network/fault/reboot/downgrade actions, a product decision for signing and an honest fixed-URL 3xx method, subjective UI acceptance, a later main-branch shell-only version for Raw update testing, and separate GitHub push/environment/workflow/tag/release authority. Every 7.1–7.4 cell and both 24-hour soaks must record `PASS`; `GH-*` is post-device-gate but mandatory before publication. |
| 9 regression fix | accepted (automated) | 2026-08-02T00:54:58+08:00; real-device evidence showed v2.2.0-4 → v3.0.0-rc.1 preinst aborting before the first legacy snapshot because neither `stat` nor the BusyBox `stat` applet exists. Added a shared target metadata helper with fail-closed `ls -ldn`/awk fallback; embedded it before every lifecycle migration hook; applied it to script/config metadata and diagnostics; added the same self-contained mode fallback to the downgrade finalizer; and updated exact IPK/APK hook/payload inspection. The regression test first failed with empty mode results under a PATH without both stat forms, then passed. Required gate `PATH=/tmp/multilogin-phase1-tools.pcM2io/root/usr/bin:$PATH CI=1 MULTILOGIN_REQUIRE_TOOLING=1 timeout 60s ./tests/run.sh` passed `19/19`, zero skips; 24.10 SDK clean package compile and exact read-only IPK inspection passed for `luci-app-multilogin_3.0.0-rc.1-r1_all.ipk`, SHA-256 `c932e7be931b28d7c3f695c373653c8117a26c34556a35083a2582691144d485`. | Independent read-only Terra `/root/phase8_release`: `PASS`; confirmed portable mode/UID/GID and special-bit parsing, embedded hook ordering, finalizer fallback, runtime coverage, and fail-closed behavior. | D-019 added. The prior failed-device migration directory is left untouched; retrying the repaired package, verifying actual preinst/postinst behavior, and any cleanup on the device remain user-authorized Phase 9 actions. |
| 9 regression follow-up | accepted (automated) | 2026-08-02; accepted content commit `ad84d2d`. QEMU OpenWrt 23.05.5 reproduced the r4 failure after the generated-init fix: JSHN `json_get_keys` dereferenced optional `$2` under nounset (`line 237: 2: parameter not set`). The broader cause was confirmed with the real SDK JSHN: missing-field lookups dynamically expand unset variables and cannot be made safe by incremental shims; `json_load` also swallows the parser's nonzero status for malformed brace-delimited text. Removed global `set -u`, `JSON_PREFIX`/`JSON_UNSET` shims, and custom `json_init` overrides from both backends; added narrow `jshn -r` status validation before native `json_load`; retained explicit empty optional arguments and unnamed-object arguments; added `tests/test-jshn-contract.mjs` using the real SDK JSHN and BusyBox ash for normal, missing, malformed, nested, repeated-init, and envelope paths; made the package-scope SDK workflow run that contract before compilation for both matrix entries; bumped the package revision to `r6`. Required bounded gate passed `20/20`, zero skips, including ShellCheck/shfmt and the JSHN contract; the same contract passed against both 24.10.8 and 25.12.5 SDK JSHN. Clean SDK builds and read-only inspection passed: 24.10 IPK SHA-256 `40e7a227357e4709f91052bf23c4a767443d6a31bb67f26534ec18f69810fa37`, 25.12 APK SHA-256 `99bfc4646989f06c86ef9149299f2f36911cf4d1a4944b3923d635af305a0f97`. Disposable QEMU installed r6 and passed positive `get_overview`/`get_settings`/`script_info` plus negative missing/extra/wrong-type/malformed/nested-state RPC cases; every path returned a valid JSON envelope and no `No response`. | Independent Terra `/root/r6_review2`: `PASS`; confirmed both backends route every `json_load` through `ml_json_load`, no global nounset/shims/overrides remain, explicit optional args are present, both SDK contracts and the 20/20 gate pass, and `git diff --check` is clean. | D-020 is superseded for JSHN handling by D-021. The r6 IPK/APK must pass SDK inspection, QEMU RPC smoke, and then the authorized real-device Phase 9 checks before RC acceptance; no portal login/logout was automated. |
| 9 regression follow-up (r7) | accepted (automated) | 2026-08-02; baseline `ad84d2d`; final code commit `f5e7eaa`. Device screenshots and LuCI 23.05 source inspection showed that title-bearing compatibility aliases remained visible, cached menu indexes survived upgrades, ambiguous empty RPC expectations allowed invalid/null page state, and conditional `null` DOM children were rendered as literal text by the legacy appender. Removed compatibility-alias titles, changed all 31 frontend declarations to whole-envelope expectations, added live-root-only `/tmp/luci-indexcache.*` invalidation after migration/rpcd refresh, and filtered every optional child list in the five views. Added static regressions to JSON/Phase 4/Phase 7 tests. The first cloud run `30749134201` correctly blocked on ShellCheck `SC3043`/`SC2015` in the new loop; replacing `local` and the ambiguous guard produced `f5e7eaa`, and the independent Terra reviewer `/root/r7_review` returned `PASS`. Final cloud run `30749257902` passed the offline gate, real 24.10.8 and 25.12.5 SDK JSHN contracts, both SDK compilations, and read-only artifact inspection. Local `./tests/run.sh` passed `16` checks with `4` optional tooling skips; focused Phase 4 `7/7`, Phase 7 `13/13`, Phase 8 `7/7`, Node syntax, JSON, version matrix, and `git diff --check` passed. Cloud artifacts were checksum-verified: 24.10 IPK `luci-app-multilogin_3.0.0-rc.1-r7_all.ipk` SHA-256 `ee09e290ea0666430f6afdbdaac2914d192533d46ee5c4ee010721af59738d49`; 25.12 APK `luci-app-multilogin-3.0.0_rc1-r7.apk` SHA-256 `6e0a75e1ed89deae5a63866973d9170441e379f5a7b7412d29ebdb9453a49383`. No device action, portal operation, package installation, or network mutation was performed. | D-022 added. Remaining risks are user-authorized retry on the real device and browser local menu storage possibly requiring a hard refresh after upgrade. |
| 9 regression follow-up (r8) | accepted (automated) | 2026-08-02; baseline `b29b9df`; accepted content commits `cf0bd26` and `87ae27f`; Playwright/QEMU reproduced and fixed rpcd-injected `ubus_rpc_session` rejection; both shell backends now filter only trusted transport metadata and preserve exact business schemas. Local bounded runner passed `16` checks with 4 optional tooling skips; cloud run `30752936857` passed offline tests, SDK JSHN contracts, 24.10.8 IPK, and 25.12.5 APK builds/inspection. | Independent read-only `/root/r7_review`: `PASS`. | D-023 added; device retry remains manual-authority. |
| 9 regression follow-up (r9) | implementing | 2026-08-02; baseline `4ad22b5`; main agent. Fixed LuCI 23.05 boolean-attribute serialization in Overview, Configuration, Network, Diagnostics, and Script Manager by omitting false `disabled` attributes; bumped package revision to `r9`; focused JS/static checks and the bounded local runner pass (`16` checks, 4 optional tooling skips). | Independent browser/device review pending; no device or portal action performed. | D-024 added. Build and install `r9` before the next real-device retry; verify buttons and editor are clickable when idle and disabled only during active requests/recovery. |
| 9 regression follow-up (anonymous UCI sections) | accepted (automated) | 2026-08-03; baseline `6967a3b`; main agent plus read-only Sol advisor; accepted content commit `ba9b54b`. Fixed `ml_collect_sections()` to use `uci -X show`, capture/clear its transient listing, and fail closed before parsing; `ml_section_is_anonymous()` now correlates extended and ordinary UCI listings by type/order so named `cfg_*` sections are preserved; new account/instance writes allocate named sections; legacy generated sections are normalized before edits/references, with referenced anonymous instances named before account-link rewrites and all failure paths reverting the UCI transaction. Updated the v3 UCI contract to supersede the old `uci add` creation wording. Added Phase 7 pure/static regressions for anonymous/named enumeration, stable naming, reference rewrites, no-change rollback safety, allocator ordering, and rejected `@type[index]` expressions. `node --check tests/test-phase7-logic.mjs`, `node tests/test-phase7-logic.mjs` passed `15/15`; `sh -n root/usr/libexec/multilogin-config`, JavaScript syntax, and `git diff --check` passed; bounded `timeout 60s ./tests/run.sh` passed `16` checks with 4 optional tooling skips. Independent Sol review returned `PASS` and confirmed the AWK section filters cannot mistake option lines for headers. A normal SDK compile was blocked before this package by the SDK's unconfigured kernel build directory while compiling `ipset`; an `IGNORE_ERRORS=1` package staging pass produced `luci-app-multilogin_3.0.0-rc.1-10_all.ipk`, and read-only artifact inspection passed. | D-025/D-026 apply; package release is r10. Real UCI create→commit→fresh-read, Configuration-page account add/readback, edit/reference stability, delete-conflict behavior, clean SDK matrix compilation, package install, and device cleanup remain deferred/manual; no portal/device state was touched. |
| 9 regression follow-up (r10 audit) | accepted (automated) | 2026-08-03T01:15:00+08:00 through 2026-08-03T01:44:19+08:00; baseline `8251d97`; main agent plus read-only Sol advisor; accepted content commit `8d83a52`. Hardened `login_control.bash` anonymous-instance enumeration and fail-closed loading, corrected `cqu-portal.sh` local-failure envelope classification, updated `CHANGELOG.md`/`docs/v3/rc-device-acceptance.md` to r10, added controller/portal/release regressions, and force-added `.gitignore` for local Node/Playwright files. `timeout 60s ./tests/run.sh` passed `16` checks with 4 optional-tool skips; `node tests/test-controller.mjs` passed `19/19`; `node tests/test-cqu-portal.mjs` passed `9/9`; `node tests/test-phase7-logic.mjs` passed `15/15`; `node tests/test-phase8-release.mjs` passed `7/7`; `node tools/release/version-matrix.mjs --tag v3.0.0-rc.1` passed; `git diff --check` passed. | Independent Sol whole-repository product/code review returned `PASS`; it explicitly verified LuCI account creation/persistence from `configuration.js` through RPC/ACL/UCI commit/readback, and found no remaining P0/P1 blocker. | D-027 applies. Real LuCI UCI commit/readback, package install/upgrade, service/controller runtime, portal behavior, network recovery, SDK matrix compilation, and device cleanup remain Phase 9 `DEFERRED-MANUAL`; ShellCheck, shfmt, BusyBox ash, and real SDK JSHN remain CI/tooling checks. |
| 9 regression follow-up (r11 validator) | implementing | 2026-08-03T02:33:35+08:00 onward; baseline `db80770`; main agent. QEMU LuCI request reached `save_account` with correct string fields but returned `invalid_request/invalid account`; `uci show multilogin` remained unchanged. Read-only Sol review returned `BLOCK` and identified `$(printf '\n')` command-substitution stripping as the root cause. Fixed `ml_valid_text()` with sentinel-preserved LF construction, added executable extracted-function tests for ordinary/UTF-8/TAB/CR/LF/empty/length cases, and bumped `PKG_RELEASE` to 11 with changelog/handout/device-candidate records. Focused Phase 7 now passes `16/16` under elevated local shell execution; clean r11 package build/install and QEMU account/network evidence are pending. | Independent Sol review is `BLOCK` until this fix is packaged and QEMU rerun; no Portal request was made. | D-028 applies. r10 is rejected for account/instance persistence; r11 QEMU smoke remains required. Real-device Phase 9 actions, Portal operations, network/service mutation outside disposable QEMU, and publication remain manual-authority. |
| 9 regression follow-up (r12 awk compatibility) | implementing | 2026-08-03T02:39:00+08:00 onward; baseline `db80770`; main agent. After r11 installation, QEMU accepted the account (`account_1`) but `save_instance` rolled back with `configuration write failed`; BusyBox trace showed `ml_section_is_anonymous()` invoking bare `!~` awk patterns and returning parse errors. Wrapped both filters in explicit actions, added a Phase 7 static compatibility assertion, and bumped `PKG_RELEASE` to 12 with synchronized candidate records. r12 package compilation and QEMU rerun remain pending; no Portal request was made. | Sol's r11 review remains `BLOCK` for the now-fixed validator; a fresh independent review is required after r12 focused/full gates and QEMU evidence. | D-029 applies. r10/r11 are rejected for the observed persistence defects; real-device Phase 9 and all Portal/service/network mutation outside disposable QEMU remain manual-authority. |
| 9 regression follow-up (r13 optional field) | implementing | 2026-08-03T02:44:00+08:00 onward; baseline `db80770`; main agent. r12's BusyBox-compatible section detection succeeded, but blank `v6face` deletion returned nonzero after the instance fields were staged, causing rollback. The `else` path now ignores an already-absent option, adds a focused static regression, and bumps `PKG_RELEASE` to 13 with synchronized candidate records. r13 package compilation and QEMU rerun remain pending; no Portal request was made. | Fresh independent review remains required after the integrated r13 gate and QEMU smoke. | D-030 applies. r10–r12 are rejected for observed account/instance persistence defects; real-device Phase 9, Portal operations, and network/service mutation outside disposable QEMU remain manual-authority. |
| 9 regression follow-up (r14 fail-closed optional field) | implementing | 2026-08-03T02:55:00+08:00 onward; baseline `db80770`; main agent. Sol's second review found r13's unconditional optional-delete ignore could falsely report success if an existing `v6face` delete failed. r14 now treats only UCI status 1 (missing option) as an idempotent no-op and routes all other read/delete failures through the existing rollback guard; focused tests, clean SDK build, IPK inspection and fresh QEMU persistence smoke are pending. | Sol review remains `BLOCK` until r14 evidence is rerun; no Portal request was made. | D-031 applies. r10–r13 remain rejected for observed persistence/fail-open defects; Phase 9 device/Portal/network/service mutation and publication remain manual-authority. |
| 9 regression follow-up (r15 exact optional field) | implementing | 2026-08-03T03:05:00+08:00 onward; baseline `db80770`; main agent. Sol rejected r13's unconditional ignore and flagged r14's status-code assumption. r15 now reads the complete instance section, detects the exact `v6face` option, checks deletion only when present, and sends read/grep/delete failures through rollback; focused tests and a fresh r15 package/QEMU run are pending. | Independent Sol review remains `BLOCK` until r15 evidence is rerun; no Portal request was made. | D-032 applies. r10–r14 remain rejected for observed persistence/fail-open defects; all real-device Phase 9 and publication actions remain manual-authority. |
| 9 regression follow-up (r16 anchored optional field) | accepted (automated) | 2026-08-03; baseline `db80770`; accepted content commit `89ff623`; main agent plus independent Sol advisor. Sol reproduced r15's unanchored fixed-string match against a legal alias containing option-like text; r16 anchors `grep -Eq` to `^multilogin.$section.v6face=`, adds an adversarial pure regression, and synchronizes package/docs metadata to release 16. Phase 7 passed `16/16`; full `CI=0 timeout 60s ./tests/run.sh` passed `16` checks with four optional tooling skips; controller `19/19`; portal `9/9`; version matrix release 16; `sh -n`, JS syntax and `git diff --check` passed. The 24.10.8 SDK staging build produced `luci-app-multilogin_3.0.0-rc.1-r16_all.ipk` SHA-256 `39721a9bb9134284d627925ae5edc04c9a0126bf14f4028a07fc40d2d6362396`; `inspect-artifact.sh` passed. Disposable QEMU installed r16 and strict Playwright evidence shows only `save_account`, `save_instance`, `quick_setup` among product writes, with no `test_instance`, `logout_instance`, or `service_action`; fresh UCI readback contains `account_1`, disabled `instance_1`, blank v6face, and network-state generation 1/count 2 with `ml3_if_1/2`, mwan3 members and firewall zone. Direct QEMU checks also saved a legal alias containing option-like text and cleared an existing `v6face=lan`, both with fresh readback success. Screenshots/evidence remain under `/tmp/multilogin-qemu-r10/screenshots/`; no Portal request was made. | Independent Sol advisor: `PASS`; confirmed anchored exact-field detection, fail-closed section/read/grep/delete paths, QEMU adversarial/existing-v6face evidence, product persistence chain, and metadata synchronization. | D-033 applies. r10–r15 are rejected for observed persistence/fail-open defects. Real-device Phase 9 cells, 25.12 APK validation, Portal behavior, service/network recovery and publication remain manual-authority. |
| 9 regression follow-up (r17 UI) | accepted (automated) | 2026-08-03; baseline `3663793`; accepted content commit `78c4346`. Added the shared `multi-login.css` visual layer and reorganized Overview, Configuration, Network, Diagnostics, and Script Manager into consistent cards, status badges, grouped actions, responsive tables/forms, and explicit loading/error/empty feedback; all roots remain native `div` nodes for the LuCI outer landmark. Bumped `PKG_RELEASE` to 17 and synchronized changelog, handout, candidate notes, and archive inspection. Phase 7 passed `16/16`; Phase 8 `7/7`; Phase 6 `8/8`; full `CI=0 timeout 60s ./tests/run.sh` passed `16` checks with four optional tooling skips; all view `node --check`, version matrix, `git diff --check`, clean 24.10.8 SDK staging, read-only inspection, and payload-to-source comparison passed. The resulting IPK `luci-app-multilogin_3.0.0-rc.1-r17_all.ipk` has SHA-256 `7a7571660666b18dd2ac9611c1973b85c6dfa3d5079a6ca4eecc10bf16f1a1d7`. No Portal or real-device action was performed. | Independent Sol UI/product/code review: `PASS`; confirmed consistent hierarchy, accessibility states, native LuCI compatibility, and no RPC/UCI/ACL/service/portal regression. | D-034 applies. Subjective browser acceptance at target 1440px/390px widths, 25.12 APK validation, all real-device Phase 9 cells, Portal behavior, service/network recovery, and publication remain manual-authority items. |
