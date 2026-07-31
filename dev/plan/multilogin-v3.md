# MultiLogin v3 Execution Plan

Status: **Phase 5 accepted**

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

- **Compile/static:** shell and JavaScript syntax, ShellCheck, shfmt, JSON/menu/ACL validation, secret/unsafe-pattern scanning, SDK compilation, workflow validation, and read-only artifact metadata/file-list inspection.
- **Pure logic:** parsers, request/response classification, CLI mapping, retry arithmetic, metadata/version rules, state-transition reducers, ownership plans, validation predicates, and deterministic serialization. Inputs and outputs stay in memory or ordinary temporary files and do not claim operating-system integration.
- **Narrow boundary stubs:** a small child-process stub may capture argv/stdin or return a fixture when required to prove a repository-owned security contract. It must not reproduce OpenWrt command behavior or an opkg/service lifecycle.
- **Explicitly out of scope unattended:** simulated router rootfs, fake opkg unpack/hooks, fake procd/init/UCI/ubus/mwan3/network/firewall behavior, service-state matrices, reboot recovery simulation, and full-tree lifecycle emulation.
- End-to-end install, upgrade, downgrade, service restoration, network ownership/recovery, and portal/device behavior are `DEFERRED-MANUAL` to Phase 9. Earlier phases verify their source-level design and compileability only.
- The default local/CI runner contains only the allowed scope above. Historical platform-simulation suites are removed from that runner; they may be deleted or retained only as explicitly non-gating developer diagnostics, and no further effort is spent expanding them.
- Host-only checks use no real sleeps, retry loops, or environment emulation. The non-SDK gate has a 60-second CI budget and each child check has an explicit timeout; SDK compilation runs as a separate Phase 8 job.

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

Complete PR CI, reusable OpenWrt 23.05/24.10 SDK compilation, script-version gates, artifact metadata checks, checksums, changelog validation, and approved GitHub Releases. Snapshot builds remain non-blocking.

**Pre-phase investigation**

1. Identify supported SDK targets/architectures, runner images, package dependencies, artifact naming, current tag/version conventions, and repository GitHub permissions.
2. Separate shell-only publication from IPK release: determine which paths require script API/version bump, package version/release bump, both, or neither.
3. Define RC/stable tag policy, reproducibility data, checksum format, changelog sections, provenance, permissions, concurrency, and approval environments.

**Detailed tasks and ownership**

- CI implementation subagent owns PR/lint/unit workflows and reusable SDK build workflow.
- Release implementation subagent owns version/checksum/changelog/release workflows and does not publish anything.
- Test subagent owns workflow static checks, read-only artifact inspection scripts, pure version-matrix expected failures, and compile evidence. It does not simulate install/uninstall/upgrade/downgrade.
- CI runs the bounded offline compile/static/pure-logic command, secret scanning, and supported SDK builds with pinned/minimal permissions.
- Release checks require tag/Makefile/script metadata/changelog/artifact names/checksums to agree; RC is `v3.0.0-rc.1` and stable is `v3.0.0`.
- Shell-only changes validate and may update only the fixed Raw script on `main`; they do not claim an IPK update. Package/API changes require the full release gate.
- Publishing, branch push, tags, GitHub environments, and Releases are manual-authority operations. Workflows may be created and tested but are never dispatched/published unattended.

**Acceptance and verification**

- Local/static workflow validation and both supported SDK compilations pass; artifact inspection verifies declared files, modes encoded in the archive, dependencies, versions, and checksums without installing the package.
- Supported SDK builds use reproducibly identified cached SDK inputs or safely downloaded SDKs. If a required SDK cannot be obtained or executed after bounded retries, Phase 8 is `blocked`; this is not a `DEFERRED-MANUAL` gate item.
- Artifact inspection proves file list/modes/dependencies/versions and checksums; intentionally mismatched metadata fails.

Gate: supported SDK packages compile; read-only artifact metadata, tag, Makefile, checksums, and notes agree; shell-only changes pass their dedicated compile/static/logic gate without requiring an IPK release. Install behavior remains Phase 9 manual coverage.

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
- installing, removing, upgrading, or downgrading an IPK on a real device;
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

## Progress log

| Phase | State | Evidence / commit | Review | Decisions / remaining risks |
| --- | --- | --- | --- | --- |
| Plan | accepted | Repository, portal profile, and existing plan inspected on 2026-07-31. Initial review returned `BLOCK`; four gate/durability ambiguities were corrected. | Independent reviewer `/root/plan_review`: `PASS`. | Plan is tracked and committed before Phase 0. |
| Plan scope | accepted | 2026-08-01 user-directed validation reduction: unattended gates now contain only compile/static/artifact checks, pure product logic, and narrow stdin/argv security stubs; the default runner must exclude platform simulations and stay within a 60-second non-SDK budget. | Terra `/root/phase3_controller` first returned `BLOCK` for three residual process/mock/manual-gate contradictions; all were corrected and rereview returned `PASS`. | D-010 added. Every platform integration claim is deferred to Phase 9 and every deferred matrix item must pass before RC acceptance. |
| 0 | accepted | 2026-07-31; main agent, `/root/phase0_baseline`, `/root/phase0_audit`; accepted content commit `b4fe21e66d0337839788e75e8392f77e922f329d`. Checks passed: shell/Bash/JS syntax, JSON, two byte-identical baseline reproductions, stock-script equality, contract UCI/RPC/exit coverage, secret-placeholder scan, and `git diff --check`. | Test/audit final `PASS`; independent reviewer `/root/phase0_review` found and verified the Phase 3 rpcd-launcher ordering fix, then returned `PASS`. | ShellCheck and BusyBox unavailable locally; mandatory in Phase 1 CI. Real device/portal actions and candidate root-code validation remain Phase 9 manual items. |
| 1 | accepted | 2026-07-31; main agent, `/root/phase1_tests`, `/root/phase1_ci`; accepted content commit `f0ebfe2e88181178edfef682a9f977e36f7dfc77`. Local `14 PASS/3 SKIP`; required BusyBox/ShellCheck/shfmt mode final `18 PASS/0 SKIP`; missing-tool CI negative, intentional bad cases, workflow full-history/pins/permissions, and diff checks passed. | `/root/phase1_review` blocked shallow checkout and incomplete future lint scope; fixes were rerun and reviewer returned `PASS`. | Historical mocks remain evidence for accepted phases but must not be expanded into OpenWrt/platform emulation after D-010. All shell files changed from the v2 baseline automatically enter lint. |
| 2 | accepted | 2026-07-31; `/root/phase2_script` and Luna `/root/phase2_tests_luna`; accepted content commit `8b31696fd78857b6ff63f04d1c09082a9e70c560`. Direct offline version/self-test and required BusyBox/ShellCheck/shfmt runner passed (`19 PASS/0 SKIP`); portal groups cover strict CLI, PC/mobile, exact config/UA, stdin secret framing, ret-code race, classification, IPv4/IPv6, logout precedence/bounds, identity ambiguity, signals, and concurrency. | Independent Terra reviewer `/root/phase2_review`: `PASS`. | Real read-only status/login/logout remain `DEFERRED-MANUAL` to Phase 9; no real portal/device action occurred. |
| 3 | accepted | 2026-07-31–2026-08-01; main agent, controller/RPC implementation agents, Luna test agents; accepted content commit `00758c789812ac7ab196a4658062fe063cc985ac`. Changed the package controller, unified-script account validation, three rpcd action launchers, unsafe-pattern allowlist/runner, and offline portal/controller/RPC tests. Required command `PATH=/tmp/multilogin-phase1-tools.pcM2io/root/usr/bin:$PATH CI=1 MULTILOGIN_REQUIRE_TOOLING=1 ./tests/run.sh` passed `21/21`, `0` skips; sub-suites passed portal `9`, controller `18`, and executable RPC `13`. Timing evidence covers exact `8/16/32`, no early retry, cap-before-jitter at `15/17`, success/interface reset, and multi-instance isolation; syntax/lint/format/safety/baseline/expected-failure/signal/secret/diff checks passed. | Terra `/root/phase3_review` first returned `BLOCK` for ambient `awk` before PATH/dependency validation. D-008 plus BusyBox/empty-PATH regression resolved it; rereview returned `PASS` and confirmed no code-testable gate was deferred. | D-007/D-008 added. Real portal/device checks remain `DEFERRED-MANUAL` to Phase 9; no real credential, portal, service, network, or device action occurred. |
| 4 | accepted | 2026-08-01; baseline `06453b5`; main agent, Terra production workers/reviewers, and Luna test workers; accepted content commit `f18e113`. Implemented factory/active ownership, secret-free fresh config, three compatibility wrappers, embedded lifecycle hooks, and migration/downgrade source logic. D-010 discarded uncommitted rootfs/opkg/service simulation tests and removed test-root/fake-disk/fake-service/failpoint branches from business code. Required bounded command with BusyBox/ShellCheck/shfmt on `PATH`, `CI=1 MULTILOGIN_REQUIRE_TOOLING=1 ./tests/run.sh`, passed `15/15`, zero skips in about 2 seconds; Phase 4 static/pure checks passed `5/5`; diff/static no-simulation checks passed. | Earlier reviews found downgrade-stop, lock, pinned-hash, checked-transaction, and archive-validation source defects. After fixes and the D-010 gate reduction, independent Terra `/root/phase3_controller` reran the allowed gate and returned `PASS` without claiming platform integration coverage. | D-009/D-010 added. Real opkg hook order/embedding, conffile bytes/modes, service restoration, overlay locking/atomicity, interruption/reboot recovery, fresh/upgrade/remove/downgrade, and finalizer execution are mandatory Phase 9 `PASS` items. |
| 5 | accepted | 2026-08-01 through 2026-08-01T07:20:16+08:00; baseline `9b33399`; main agent, Terra `/root/phase3_controller`, and Luna `/root/phase2_tests`; accepted content commit `75e74bcf9c1d787e90d76760dfb8f6cd75e500cb`. Implemented the fixed Raw/Custom backend, pure policy library, RPC dispatch, D-011 action envelope, activation journal/LKG recovery, and init recovery ordering. Required bounded command `PATH=/tmp/multilogin-phase1-tools.pcM2io/root/usr/bin:$PATH CI=1 MULTILOGIN_REQUIRE_TOOLING=1 timeout 60s ./tests/run.sh` passed `16/16`, zero skips in 3.1 seconds; Phase 5 static/pure checks passed `9/9`, including exact schemas, SemVer/input policy, source exposure, post-execution hash checks, and state-first LKG recovery ordering. | Contract review passed after corrections. Independent read-only Terra `/root/phase5_review` reran the allowed Gate (`16/16`, zero skips in 3.2 seconds), verified security/compatibility/transaction ordering, and returned `PASS`; earlier fail-open durable slots and pre-state LKG rotation were corrected before final review. | D-010/D-011 apply. The required runner contains no portal/controller/RPC/backend execution and no OpenWrt, rootfs, opkg, service, UCI, mwan3, network, reboot, local-HTTP, activation, or recovery simulation. Real download, validation/activation/rollback, lock/JSHN behavior, filesystem atomicity/recovery, status selection, and device behavior remain mandatory Phase 9 checks. |
| 6 | pending | Not started. | — | Subjective UX acceptance remains manual. |
| 7 | pending | Not started. | — | — |
| 8 | pending | Not started. | — | Push/tag/release remain manual; failure to obtain/run a required SDK blocks the phase. |
| 9 | pending | Not started. | — | Entire real-device matrix requires explicit authorization. |
