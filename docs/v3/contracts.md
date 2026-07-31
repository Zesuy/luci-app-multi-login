# MultiLogin v3 Contracts

Status: accepted and frozen for Phase 1 implementation

Baseline source: `main` at `fb272e8`

Execution-plan baseline: `e772078`

Current package: `luci-app-multilogin 2.2.0-4`

Target package: `v3.0.0`, first candidate `v3.0.0-rc.1`

This document records the compatibility and security boundary for v3. Later phases may refine private implementation details, but changing a public decision below requires an explicit decision-log entry, updated tests, and independent review.

## 1. Ownership and trust boundaries

| Surface | v3 owner | Update mechanism | Trust rule |
| --- | --- | --- | --- |
| `/etc/multilogin/login_control.bash` | IPK | Package only | Owns scheduling, per-instance delays, backoff, and jitter. |
| `/etc/multilogin/cqu-portal.sh` | Runtime script manager | IPK initial install; fixed GitHub Raw or validated Custom activation afterward | The only remotely replaceable executable. Owns portal `status`, `login`, and `logout`. |
| Legacy action wrappers | IPK | Package only | Translate legacy non-secret CLI syntax to `cqu-portal.sh`; contain no portal implementation. |
| rpcd backend, LuCI, init, migration and network helpers | IPK | Package only | Never replaced by the Raw updater. |
| UCI `/etc/config/multilogin` | User/config system | LuCI fixed RPC or UCI tooling | Account passwords stay server-side and write-only to browsers. |
| Script state and backups | Root-only runtime state | Fixed RPC only | Never directly exposed through LuCI file APIs. |

The Raw updater never invokes opkg and never changes the controller, wrapper, backend, UI, ACL, configuration, package database, or factory copy. In the Phase 5 gate, “no package file is updated” means no package release/install or package-owned control file is replaced; the designated runtime copy of `cqu-portal.sh` is the sole exception established by the fixed decisions.

## 2. Filesystem contract

All persistent files are owned by `root:root`. Directories reject group/other access unless noted.

| Path | Mode | Role / lifecycle |
| --- | ---: | --- |
| `/etc/multilogin/login_control.bash` | `0755` | Package-managed controller. |
| `/etc/multilogin/cqu-portal.sh` | `0755` | Atomic active portal script; updateable. |
| `/usr/lib/multilogin/cqu-portal.factory.sh` | `0755` | Package-managed factory copy used by restore; never updated from Raw. |
| `/usr/libexec/multilogin-script` | `0755` | Package-managed script-state backend/helper; exposes fixed internal `recover` mode to init and fixed RPC operations to the rpcd handler. |
| `/etc/multilogin/login.sh` | `0755` | Package-managed login compatibility wrapper. |
| `/etc/multilogin/check_status.sh` | `0755` | Package-managed status compatibility wrapper. |
| `/etc/multilogin/logout.sh` | `0755` | Package-managed logout compatibility wrapper. |
| `/etc/multilogin/.script-state/` | `0700` | Persistent script-manager state directory. |
| `.script-state/state.json` | `0600` | Mode, versions, hashes, validation state, and transaction generation. No credentials/source. |
| `.script-state/candidate.sh` | `0600` | Isolated Raw candidate; not executable as active code. |
| `.script-state/last-known-good.sh` | `0600` | Previous validated active script for rollback. |
| `.script-state/custom.draft.sh` | `0600` | Unvalidated/validated Custom draft; never active in place. |
| `.script-state/custom.preserved.sh` | `0600` | Migration preservation slot or explicit Custom backup. |
| `.script-state/activation.journal` | `0600` | Recoverable activation transaction. |
| `/var/lock/multilogin-script.lock` | `0600` | Script-state mutation lock. |
| `/etc/multilogin/.migration-v3/` | `0700` | Idempotent upgrade/downgrade state and legacy snapshots. |
| `/var/lock/multilogin-migrate.lock` | `0600` | Package migration lock. |
| `/etc/multilogin/network-journal.json` | `0600` | Phase 7 owned-network recovery journal. |
| `/var/log/multilogin.log` | `0600` | Redacted diagnostics only. |

Temporary action/curl files use an unpredictable `mktemp -d` directory under `${TMPDIR:-/tmp}`, immediately set to `0700`; files are `0600`. Traps remove them on `EXIT`, `HUP`, `INT`, and `TERM`. Names never include interface, username, password, URL query, or other user-controlled values.

`login_huxi.sh` and `login_A.sh` are not installed by v3. Known stock copies are retired. Unknown/custom copies encountered during upgrade are preserved as inactive migration artifacts and are never executed automatically.

## 3. UCI compatibility contract

Existing section names, references, and fields remain valid. Phase 4 migration does not rename sections or rewrite credential values.

| Section type | Option | Values/default | v3 behavior |
| --- | --- | --- | --- |
| `settings` (`global`) | `enabled` | `0` or `1`; default `0` | Preserved; gates daemon work. |
| | `log_level` | `debug/info/notice/warning/error`; default `info` | Preserved and validated. |
| | `retry_interval` | positive seconds; default `4` | Preserved as initial backoff. |
| | `check_interval` | positive seconds; default `5` | Preserved as controller loop interval. |
| | `max_retry_delay` | seconds >= initial; default `16384` | Preserved as pre-jitter cap. |
| | `already_logged_delay` | positive seconds; default `16` | Preserved. |
| `account` | `alias` | string | Preserved. |
| | `username` | non-empty string | Preserved; returned only where an account selector needs it. |
| | `password` | non-empty secret | Preserved server-side. Browser reads receive only `password_set`; blank update means unchanged. |
| `instance` | `enabled` | `0` or `1`; default `0` | Preserved. |
| | `alias` | string | Preserved. |
| | `interface` | logical mwan3 interface | Preserved. |
| | `v6face` | optional logical IPv6 interface | Preserved. |
| | `account` | account section reference | Preserved and validated as an existing `account`. |
| | `ua_type` | `pc` or `mobile`; default `pc` | Preserved. |

Script-manager mode and hashes are not browser-writable UCI. They live in root-only `state.json` and change only through fixed RPC transactions. Network ownership is not inferred from an `auto_` prefix; Phase 7 records exact object IDs and an ownership generation in its root-only journal/state.

Fresh v3 configuration contains only `settings.global`; it removes the stock placeholder account and instance. Upgrades preserve every existing user section. Invalid legacy values are preserved on disk for recovery but interpreted safely without silent writes: invalid booleans disable the affected item; invalid/non-positive timing values use their stock defaults; a valid maximum below the validated initial retry is treated as the initial retry at runtime; an unknown log level becomes `info`; missing/invalid instance `ua_type` becomes `pc` in the controller.

## 4. Unified portal CLI and metadata

### 4.1 Invocation

```text
cqu-portal.sh status   --mwan3 IFACE [--v6face IFACE] [--account ACCOUNT] [--ua-type pc|mobile]
cqu-portal.sh login    --mwan3 IFACE --account ACCOUNT [--v6face IFACE] --ua-type pc|mobile
cqu-portal.sh logout   --mwan3 IFACE --account ACCOUNT [--v6face IFACE] [--ua-type pc|mobile]
cqu-portal.sh version
cqu-portal.sh self-test
```

Unknown options, missing option values, extra positional arguments, and invalid `ua_type` are v3 exit-`4` errors. This deliberately tightens v2, whose parsers silently ignore unknown/extra arguments, treat invalid UA as mobile, and may let a missing option value fail at `shift 2` with shell exit `2`. Production endpoint/host/port/timeout values are not CLI parameters. Production rejects test overrides. Existing explicit test-mode command/temp/clock injection is historical non-gating diagnostic support; it must not be expanded or used to claim OpenWrt integration.

`login` reads exactly one password line from standard input using `IFS= read -r`; the trailing newline is framing and is not part of the password. Empty and NUL-containing passwords are unsupported. `status`, `logout`, `version`, and `self-test` never read or require a password.

`--password` is deliberately incompatible in v3 and returns exit `4` with non-secret migration guidance. This explicit break is required by the no-secret-in-argv boundary. Product code, RPC, controller, documentation, and tests must never construct that flag.

Legacy wrapper behavior:

- `login.sh` accepts the non-secret flags above plus `--check-only`; normal login reads the password from stdin, and `--check-only` maps to `status` without reading stdin. For direct-v2 compatibility only, an omitted `--ua-type` defaults this login wrapper to `mobile`; the unified core itself requires an explicit type.
- `check_status.sh` maps to `status` and accepts the existing non-secret interface/account/UA flags.
- `logout.sh` maps to `logout`; legacy `--ua-type` remains accepted even though logout classification does not depend on it.
- Every wrapper rejects `--password`. The controller and all three current rpcd action launchers migrate to stdin/unified-script calls in Phase 3 before wrappers become final in Phase 4.

### 4.2 Static metadata and commands

The script contains literal, non-evaluated assignment lines:

```text
MULTILOGIN_SCRIPT_API=3
MULTILOGIN_SCRIPT_VERSION='3.0.0-rc.1'
```

The backend parses only anchored literal assignments and never sources a candidate. Versions follow SemVer (prerelease allowed); API compatibility requires the integer `3`. `version` returns the same values in the standard output envelope. `self-test` performs syntax-independent internal parsing/encoding checks without resolving an interface, reading credentials, or making a network request.

### 4.3 Output envelope

Each action writes exactly one compact JSON object to stdout:

```json
{"ok":true,"action":"status","outcome":"online","error_kind":null,"api":3,"version":"3.0.0-rc.1","data":{}}
```

Required keys are `ok`, `action`, `outcome`, `error_kind`, `api`, `version`, and object `data`. `ok` means the action produced a trustworthy result, not that the session is online: status `offline` is `ok=true/error_kind=null/exit 1`, and login `already_online` is `ok=true/error_kind=null/exit 2`. A rejected login is `ok=false/error_kind=auth/exit 1`. Logout follows the later evidence-precedence table, so an early rejection becomes success, timeout, or indeterminate rather than a standalone exit-1 outcome. Other failures use one of `transport`, `protocol`, `classification`, `timeout`, `arguments`, `dependency`, `interface`, `encoding`, or `internal`. `data` is allowlisted and may contain `phone_flag`, expected UA type, poll count, or non-sensitive validation metadata. It never contains password, full request URL/query, curl config, raw portal body, username, or account reference.

Human diagnostics go to stderr and the root-only log in redacted form. Portal messages/responses are classified but not echoed verbatim because they may reflect request fields.

### 4.4 Exit and outcome mapping

| Exit | Stable meaning | Action outcomes |
| ---: | --- | --- |
| `0` | Requested state established or read positively | `online`, `login_success`, `logout_success`, `already_offline`, `version`, `self_test_pass` |
| `1` | Valid negative portal result | status `offline`; login `auth_rejected` |
| `2` | Login was unnecessary because the session was already online | login `already_online` only |
| `3` | Transport/protocol result is indeterminate | `transport_error`, `protocol_error` |
| `4` | Invalid/missing argument or invalid stdin credential framing | `argument_error` |
| `5` | Required local command/capability missing | `dependency_error` |
| `6` | Interface/device/address resolution failed | `interface_error` |
| `7` | Local encoding failure | `encoding_error` |
| `8` | Requested login state is unsafe because the observed/pre-existing `phone_flag` does not match the requested UA type | `classification_mismatch` |
| `9` | Bounded logout polling expired before offline | `logout_timeout` |

This preserves existing status/login meanings for `0`, `1`, `2`, and local errors `4`–`7`. The current login script's transport failure changes from generic `1` to `3`; new `8` and `9` make safety failures explicit. The controller uses both exit and `outcome/error_kind`, treating malformed/missing JSON as internal/protocol failure.

## 5. Portal protocol contract

The dated local profile is authoritative until a newer, verified capture is explicitly accepted. Through Phase 8, protocol parsing, serialization, and classification are verified with redacted fixtures and host-independent logic only; device commands and request execution are Phase 9 checks.

- Base API is `https://login.cqu.edu.cn:802`; redirects are not part of the portal action contract. Status requests use `jsVersion=4.X`; login/logout requests use `jsVersion=4.2.2`.
- Status calls `/eportal/portal/online_list` with callback, empty `user_account`/`user_password`, uppercase MAC, Base64 IPv4/IPv6, cache value `v`, and `lang=zh`. `result=0` is offline; `result=1` is online. `list[].phone_flag=0` is PC and `1` is mobile.
- Login calls `/eportal/portal/login` with `login_method=1`, `user_account=,<operator>,<account>`, password, plain IPv4/IPv6/MAC, empty AC fields, UA/terminal fields, callback/cache fields, `lang=zh-cn`, and the portal helper's second `lang=zh`. PC uses operator/term/terminal `0/1/1`; mobile uses `1/2/2`.
- The PC UA is `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36`. The mobile UA is `Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36`. The HTTP `User-Agent` header byte-for-byte equals `term_ua`.
- A mode-0600 curl config holds all space-bearing and secret values. The only mwan3 wrapper argv is `mwan3 use "$interface" curl --config "$config"`; password and UA never appear in process argv.
- Login success is not complete until status polling (five attempts, one second apart) observes the requested `phone_flag`. Online with the wrong flag exits `8`; never becoming online is a protocol failure. Pure logic cases supply polling observations directly; automated acceptance does not replace runtime sleep/clock behavior.
- Logout is idempotent: if initial status is offline, return `0/already_offline`. Otherwise call `/eportal/portal/mac/unbind` with account, `wlan_user_mac=000000000000`, plain IPv4, resolved IPv6 or `::`, callback/cache/language fields; then call `/eportal/portal/custom/checkLogout` with plain addresses and action metadata; then poll `online_list` up to ten times, one second apart. Attempt checkLogout and polling even if unbind returns a negative/transport result. Do not start a replacement login before offline is confirmed.

When `online_list` has multiple records, filter by exact normalized local MAC when the response exposes MAC, then by exact local IP when it exposes IP. After all available identity filters, exactly one record must remain; zero or multiple records are a protocol error. If identity fields are absent, only a single-record list is accepted. A login precheck that finds the requested `phone_flag` returns `2/already_online`; the wrong flag returns `8/classification_mismatch` and never logs out or replaces the session automatically.

Logout result precedence is fixed:

| Unbind/checkLogout result | Poll evidence | Final result |
| --- | --- | --- |
| Any result | Any valid poll observes offline | `0/logout_success`; offline evidence wins. |
| Any success, negative, or transport/protocol result | At least one valid poll, all valid polls remain online through the bound | `9/logout_timeout`; retain any earlier stage result only as redacted metadata. |
| Any result | No poll produces a valid status | `3/transport_error` or `3/protocol_error` according to the polling failure. |

| v2/profile delta | v3 decision |
| --- | --- |
| v2 curl has no matching HTTP `User-Agent`, and installed mwan3 splits space-bearing arguments via `$*`. | Root-only curl config; only `--config` crosses mwan3; exact header/`term_ua` equality. |
| v2 accepts login success without checking `phone_flag`. | Bounded status confirmation and exit `8` on mismatch. |
| v2 status unnecessarily requires account/password because `--check-only` enters login main validation. | `status` requires no credential and never reads stdin. |
| v2 logout calls `checkLogout` before unbind, uses the actual MAC, and never polls offline. | Captured order, zero MAC for unbind, and bounded polling as specified above. |
| `login_A.sh` uses obsolete HTTP/801 and an old status host. | Retire the stock template; never activate it automatically. |

Pure fixture/serializer tests freeze parameter names, duplicate `lang` behavior where required, JSONP stripping, Base64, UA equality, classification, and polling decision bounds. They supply deterministic callback/cache inputs directly and do not emulate runtime clocks or sleeps.

## 6. Controller/backoff contract

`login_control.bash` remains Bash and retains the current UCI timing fields and per-instance scheduling role.

- Each enabled instance has independent unjittered `base_delay` and `last_attempt` state. `base_delay` starts at `retry_interval`, but the first daemon attempt is immediate (`last_attempt=0`), preserving v2 behavior.
- After any action failure exit `1` or `3`–`9`, set `base_delay=min(base_delay*2,max_retry_delay)` and schedule with jitter. Thus defaults yield post-failure bases `8,16,32,...,16384`; auth, transport, protocol, classification, timeout, argument, dependency, interface, encoding, and malformed-output classes share this safe retry schedule but log distinct classifications.
- Bounded jitter is an injected/random integer in `[-floor(base/10), +floor(base/10)]` after `base` is capped; a range of zero means zero jitter. Final delay is at least one second and at most `max_retry_delay + floor(max_retry_delay/10)`.
- Success or observed mwan3 online resets `base_delay` to `retry_interval`. `already_online` sets the next base to `already_logged_delay`; a later success/interface recovery resets normally.
- Jitter changes only the scheduled wait, never the stored base used by the next doubling. No failure class busy-loops; local/internal classes log a redacted configuration error.
- Disabled global state exits successfully. No enabled instances remains an idle, signal-responsive daemon for v2 compatibility. Unavailable mwan3 status sleeps `check_interval` without invoking login.
- Passwords are read from UCI into controller memory, piped to child stdin, and never passed to a function as an interpolated command, argv, `eval`, file name, or log field.

## 7. RPC compatibility and target surface

### 7.1 Current v2 methods

The following object methods and parameter names are preserved through v3 so LuCI upgrades do not fail mid-transaction:

| Method | Parameters | v3 disposition |
| --- | --- | --- |
| `quick_setup` | `base_iface`, `count` | Preserve name; Phase 7 replaces prefix deletion with owned transaction/journal. |
| `list_auto` | none | Preserve; return only exactly owned resources. |
| `remove_auto` | none | Preserve; remove only exactly owned resources. |
| `check_instance` | `section` | Preserve; invokes `status` without a password. |
| `test_instance` | `section` | Preserve as explicit login action; password goes through stdin and output is allowlisted. |
| `logout_instance` | `section` | Preserve as explicit logout action; no password is passed. |
| `save_instance` | `section`, `enabled`, `alias`, `interface`, `v6face`, `account`, `ua_type` | Preserve fields with type/reference validation. |
| `delete_instance` | `section` | Preserve with reference/type validation. |
| `save_account` | `section`, `alias`, `username`, `password` | Preserve writes; blank password retains existing secret. |
| `delete_account` | `section` | Preserve only when no instance references the account, or return a conflict. |

The exact v2 response/effect baseline is:

- `quick_setup` success is `{"result":"ok","count":N,"base_iface":"..."}`; it deletes all matching `auto_*` network/mwan3/firewall/policy entries, creates and commits replacements, then asynchronously reloads network, firewall, and mwan3. Invalid input prints top-level `error` and exits rpcd handler `1`.
- `list_auto` is `{"base_iface":"...","count":N,"interfaces":[{"name":"...","device":"...","metric":"..."}]}`. `remove_auto` is `{"result":"ok"}`, performs the same broad-prefix commits, and asynchronously reloads the three services.
- Action methods return top-level `action`, `section`, `alias`, `interface`, `v6face`, `account_ref`, `username`, `ua_type`, integer `code`, localized `status`, boolean `success`, and raw combined-script `output`. Check maps `0/1/other` to online/offline/check-failed; test maps `0/1/2/other` to login-success/login-failed/already-online/script-error; logout maps `0/1/other` to logout-success/logout-failed/script-error. An action-script nonzero code still emits JSON and the rpcd handler itself normally exits `0`; validation errors emit `error` and exit `1`.
- Save/delete success is top-level `{"result":"ok"}` plus `section` when created/saved. Instance save/delete commits UCI and asynchronously restarts MultiLogin; account save/delete commits without service restart. Account delete currently ignores instance references.

V3 removes raw/localized output and unsafe side effects, but preserved method names carry a one-major-version cached-client adapter: the standard envelope is authoritative, while safe legacy top-level keys (`result`, `count`, `base_iface`, `interfaces`, `action`, `code`, `status`, `success`, sanitized `output`, `section`, or `error` as applicable) are duplicated through v3.x. The adapter never restores passwords, usernames in action results, raw command output, prefix-wide deletion, or arbitrary service actions. Removal of these compatibility keys requires a future major version.

Ordering constraint: Phase 3 changes `check_instance`, `test_instance`, and `logout_instance` to call unified `status`, `login`, and `logout` before Phase 4 replaces legacy wrappers. Status/logout receive no password; login receives it only on stdin. Phase 3 keeps safe legacy top-level action status/code fields so cached LuCI continues to work; Phase 5 later integrates these launchers into the full standard backend/update state machine.

### 7.2 Standard RPC envelope

Every v3 method returns one object:

```json
{"ok":true,"code":"ok","message":"","data":{}}
```

Failures set `ok=false`, use a stable lower-snake-case `code`, provide a bounded non-secret `message`, and return an object `data`. No method returns arbitrary command stdout/stderr, a MultiLogin account password, full UCI account objects, raw portal bodies, file paths supplied by a client, or script content except the explicitly requested Custom draft returned by `script_get_draft`.

### 7.3 New fixed method families

Exact method names are reserved now; detailed data schemas are frozen in the owning phase before implementation:

- Configuration (Phase 7): `get_overview`, `get_settings`, `save_settings`, `list_accounts`, `list_instances`, `service_status`, `service_action`, `get_diagnostics`, `get_logs`, `clear_logs`.
- Script backend (Phase 5): `script_info`, `script_check`, `script_stage`, `script_validate`, `script_activate`, `script_rollback`, `script_restore`.
- Custom draft (Phase 5 backend support for the Phase 6 UI): `script_get_draft`, `script_save_draft`, `script_discard_draft`.
- Owned network recovery (Phase 7): `network_recover` in addition to preserved quick-setup methods.

Script methods accept no URL or arbitrary path. `script_activate` identifies only the server-side `candidate` or validated `custom` source and requires its expected SHA-256/base generation. `service_action` allowlists `start`, `stop`, `restart`, `enable`, and `disable` for `multilogin` only.

#### 7.3.1 Phase 5 script RPC schemas

All Phase 5 parameters are members of one JSON object and unknown fields are rejected. `expected_generation` is a non-negative integer, hashes are lowercase SHA-256, and booleans are JSON booleans. A successful mutation increments `generation` exactly once; a rejected operation does not change durable state.

| Method | Exact parameters | Success `data` |
| --- | --- | --- |
| `script_info` | none | Keys `raw_url`, `generation`, `mode`, `recovery_required`, `active`, `factory`, `candidate`, `last_known_good`, `custom`, and `preserved`; the last six are exact summaries. No script source. |
| `script_check` | none | Keys `available`, `downgrade`, `relation`, `active_sha256`, and `remote` (exact summary). It downloads to an ephemeral file for static inspection only and never stages or executes it. |
| `script_stage` | `expected_generation` | Keys `generation` and `candidate` (Raw summary with status `staged`, or its unchanged current status for `no_change`). |
| `script_validate` | `source` (`candidate` or `custom`), `expected_sha256`, `expected_generation`, `confirm_execute` | Keys `generation`, `source`, `summary`, and `validation={"self_test":"passed"}`. The summary status is `validated`; `confirm_execute` must be literal true. |
| `script_activate` | `source` (`candidate` or `custom`), `expected_sha256`, `expected_generation`, `confirm_activate`, `allow_downgrade` | Keys `generation`, `mode`, `active`, and `validation`. `confirm_activate` must be true. `allow_downgrade` is consulted only for a lower-version managed candidate and has no effect for Custom. |
| `script_rollback` | `expected_sha256`, `expected_generation`, `confirm_activate` | Keys `generation`, `mode`, `active`, and `validation`. `expected_sha256` names the current LKG shown by `script_info`. |
| `script_restore` | `expected_sha256`, `expected_generation`, `confirm_activate` | Keys `generation`, `mode` (`managed`), `active`, and `validation`. `expected_sha256` names the immutable factory shown by `script_info`. |
| `script_get_draft` | none | Keys `generation`, `source="draft"`, `summary`, and `content`. A missing draft returns `not_found`. This is the only source-reading RPC; active and migration-preserved executable content is never returned to the browser. |
| `script_save_draft` | `content`, `base_sha256`, `expected_generation` | Keys `generation` and `custom` (status `draft`, or unchanged `validated` for byte-identical `no_change`). Changed content invalidates earlier validation. Empty `base_sha256` is accepted only when no draft exists. |
| `script_discard_draft` | `expected_sha256`, `expected_generation` | Keys `generation` and `custom`, which is the exact absent summary. It never removes `custom.preserved.sh`. |

Every summary always has exactly these fields:

```json
{"present":true,"status":"active","source":"raw","mode":"managed","version":"3.0.0","api":3,"sha256":"<64 lowercase hex>"}
```

Absent summaries use `present=false`, `status=none`, `source=unknown`, `mode=none`, `version=""`, `api=0`, and `sha256=""`. Source is `factory`, `raw`, `custom`, or `unknown`; mode is `managed`, `custom`, or `none`. Active status is `active`; factory, remote, preserved, and LKG status are `available`; candidate status is `none`, `staged`, or `validated`; Custom status is `none`, `draft`, or `validated`. A successful `script_check` always returns a present remote summary with `status=available`, `source=raw`, and `mode=managed`; transport or static rejection returns a failure envelope rather than a partial remote summary.

The exact activation/rollback/restore validation object is:

```json
{"self_test":"passed","status":"online|offline|skipped_no_instance"}
```

Self-test runs through `/bin/sh SCRIPT self-test`, is terminated after 10 seconds, and must emit at most 8 KiB containing exactly one JSON object with `ok=true`, `action=self-test`, `outcome=self_test_pass`, API `3`, and the statically parsed version. No child output is returned. Post-activation status selects the lexicographically first enabled instance having a valid interface; it passes no password and accepts only exit/envelope pairs `0/online/ok=true` or `1/offline/ok=true` with matching API/version. No usable instance yields `skipped_no_instance`; any other result fails activation.

Durable `state.json` has exactly `schema=1`, `generation`, `mode`, `active`, `candidate`, `last_known_good`, and `custom`; each nested value is an exact summary above. Factory and preserved summaries are computed read-only from their fixed files. Script source, URL, credentials, diagnostics, and validation output never enter state. If state is absent, read methods synthesize generation `0` without writing; the first successful mutation atomically creates generation `1`.

The activation journal contains exactly the keys `schema` (`1`), `generation` (starting generation), `operation` (`activate`, `rollback`, or `restore`), `source` (`candidate`, `custom`, `last_known_good`, or `factory`), `selected_sha256`, `previous_active` (exact summary), `backup_sha256`, and `state` (`prepared`, `active_replaced`, `verified`, or `rollback_required`). The previous active is first copied to a transaction backup, not directly to LKG. On successful normal activation/restore, that previous active becomes LKG; on successful rollback, active and LKG swap so a second rollback can undo the first. Mode/source metadata move with their bytes.

The package-managed init path invokes `/usr/libexec/multilogin-script recover` under the script lock before starting `login_control.bash`; every script RPC invokes the same internal recovery routine before serving its request. `recover` accepts no other argument or input and returns `0` only when no recovery remains, otherwise `1`; it emits no script content or child output. Recovery never executes candidate, Custom, or active code. For `prepared` with the starting generation still current and the prior active hash intact, it removes the unused transaction backup and journal. For `active_replaced`, `verified`, or `rollback_required` with the starting generation still current, it restores the transaction backup and prior active mode/source metadata, fsyncs the restored active, then removes the backup and journal. If durable state is already exactly generation `starting+1` and matches the selected active hash, recovery treats the transaction as committed and removes only the stale backup/journal. Any other generation/hash combination, missing/mismatched backup, or failed restore keeps the journal and backup and requires recovery.

`script_info` remains available when recovery cannot complete and reports `recovery_required=true` with the unchanged durable generation. Its active summary describes the actual active file bytes; if those bytes match neither the durable active nor the journal-selected hash, the summary uses `source=unknown` and `mode=none`. All other script methods fail before downloading, reading draft content, executing, or writing with `code=recovery_required` and `data={"generation":CURRENT}`. After successful recovery, `script_info` reports false and the original request may continue. The init service refuses to start the controller while recovery remains required; an operator may repair the retained backup/journal through root shell access and rerun the fixed `recover` command, but no browser RPC accepts a recovery path or source. Recovery does not increment generation because it either removes an uncommitted transaction or finishes restoring its starting state.

Every mutation checks `expected_generation` before any write. Hash-bearing operations then check the selected current hash. `conflict` returns only `data={"generation":CURRENT,"sha256":CURRENT_SELECTED_HASH}`. A malformed request, stale generation/hash, missing confirmation, or invalid state changes no file. If activation validation fails, the transaction backup restores the exact prior active and leaves generation, state, LKG, candidate, and Custom validation unchanged; the journal is removed after successful restoration. If restoration itself fails, state/generation/LKG still remain unchanged, the backup and `rollback_required` journal remain, and `activation_failed` returns `data={"generation":CURRENT,"recovery_required":true}`.

Exact repeated-operation rules are:

- staging bytes already held as candidate returns success `code=no_change`, preserves `staged` or `validated`, returns the current method data schema, and does not increment generation;
- validating an already validated matching source returns `no_change` without executing it again;
- activating the same active hash, source, and mode returns `no_change` without rotating LKG;
- saving byte-identical draft content returns `no_change` and preserves prior validation; otherwise save sets `draft`;
- rollback/restore to the identical active hash/source/mode returns `no_change` without rotating LKG;
- discard or read of an absent draft returns `not_found`.

Success codes are `ok` and `no_change`. Stable failure mapping is:

| Code | Condition | Failure `data` |
| --- | --- | --- |
| `invalid_request` | malformed JSON, unknown field, wrong type/enum, invalid hash/generation, empty/oversized/non-text draft | `{}` |
| `conflict` | current generation or selected/base hash differs | current generation and selected hash only |
| `not_found` | requested candidate, LKG, factory, or draft is absent | `{}` |
| `invalid_state` | source exists but is not in the required staged/validated state | `{}` |
| `download_failed` | DNS/TLS/transport/timeout, size overflow, or a non-redirect non-200 status | `{}` |
| `source_rejected` | any HTTP redirect/effective URL mismatch, unsafe file, metadata/API/SemVer/syntax rejection | `{}` |
| `confirmation_required` | required execute/activate/downgrade confirmation is false | `{}` |
| `validation_failed` | self-test timeout, size, exit, envelope, API, version, or outcome failure | `{}` |
| `activation_failed` | post-replacement validation/status or restoration failure | generation plus `recovery_required` boolean |
| `recovery_required` | retained activation journal cannot be safely recovered automatically | current generation only |
| `internal_error` | bounded local error not classified above | `{}` |

Messages are bounded, non-secret English diagnostics; callers branch on `code`, not text.

Managed downgrade means only `script_activate` of a Raw candidate whose valid SemVer is below the valid active SemVer; it requires `allow_downgrade=true`. Equal-version/different-hash Raw content is not a downgrade. Custom activation does not compare versions. Rollback and factory restore may lower a version without `allow_downgrade` because their fixed method, expected source hash, generation, and activation confirmation are the explicit authorization.

`script_check` and `script_stage` always use the fixed Raw URL and disable redirect following. Any HTTP 3xx is `source_rejected`; DNS/TLS/transport/timeout, size overflow, and every other non-200 status are `download_failed`. A successful response must be HTTP 200 with an effective URL byte-identical to the fixed URL. Downloads are HTTPS-only, bounded to 256 KiB, and subject to 8-second connect and 20-second total timeouts. Static acceptance requires a regular non-symlink file, non-empty valid UTF-8 without U+0000, anchored literal API `3` and SemVer version metadata, SHA-256, and `sh -n`; candidates are never sourced. `available` means the remote hash differs from active. `relation` is `identical`, `newer`, `older`, `same_version_changed`, or `unknown`; unknown/invalid active metadata yields `unknown` and `downgrade=false`.

Custom content is non-empty valid UTF-8 text, contains no U+0000, and is at most 256 KiB encoded as UTF-8. Before `script_validate(source=custom)` may execute self-test, it repeats the same hash, regular non-symlink file, size/text, anchored API `3`, SemVer metadata, and `sh -n` checks used for a Raw candidate; any failure is `source_rejected` and no code executes. `custom.preserved.sh` is never modified, deleted, or returned by draft operations; migration recovery/import requires explicit out-of-band root access and a deliberate paste/save into the Custom draft.

The Custom editor is a root-code editor, not secret storage. `script_get_draft` returns the exact caller-created draft because byte-preserving editing cannot be combined with content redaction. The UI and documentation must warn never to embed account credentials or other secrets in source; portal credentials continue to come only from server-side UCI and stdin. The absolute RPC password prohibition applies to MultiLogin-managed account credentials and action data, while this one explicit draft payload remains opaque administrator-authored code. Active, factory, LKG, candidate, Raw remote, and migration-preserved source are never returned by an RPC.

### 7.4 LuCI, menu, ACL, and cached-client transition

| Current route/view | Current exposure | V3 target |
| --- | --- | --- |
| `accounts` | Loads full `multilogin` UCI; masked password remains in browser memory. | `Configuration`; fixed account RPC returns `password_set`, never password. |
| `settings` | Loads full UCI, calls broad `luci.setInitAction`, and displays action username/raw output. | `Overview` plus `Configuration`; fixed service/action RPC and allowlisted diagnostics. |
| `interfaces` | Calls prefix-destructive network RPC. | `Network`; exact ownership and journal/recovery RPC. |
| `script` | Direct read/write/chmod of scripts, obsolete templates, broad init restart. | `Scripts`; fixed staged/draft RPC only. |
| `log` | Direct log read and `/bin/sh -c` truncation. | `Diagnostics`; bounded/redacted `get_logs` and fixed `clear_logs` RPC (reserved in Phase 7). |

Phase 7 menu paths are `overview`, `configuration`, `network`, `scripts`, and `diagnostics`; old paths are server-side aliases for bookmarked URLs, not old JS implementations. Package lifecycle clears LuCI index/module caches and restarts rpcd after installing the coordinated UI/backend. A browser tab that already loaded v2 JS may use the safe legacy response keys; direct file/init operations fail closed after ACL tightening and the page instructs refresh. Security grants are never retained solely for an already-open tab.

Current ACL/secret risks are recorded explicitly: UCI read exposes account passwords; wildcard `/etc/multilogin/*` reads expose root scripts; network/firewall/mwan3 UCI writes are broad; `test_instance` (real login) is incorrectly a read grant; `logout_instance` is both read and write; `luci.setInitAction` is not object-scoped; and views request file execution beyond the explicit file read/write entries. Portal scripts log raw response bodies plus IP/MAC, rpcd returns username and combined raw output, and the log view exposes/truncates that file. V3 removes browser UCI/file/init access for these flows and grants only named `multilogin` RPC methods by operation. Read grants contain non-mutating overview/list/status/log methods only; login/logout, service changes, script execution/activation, configuration saves, and network transactions are write grants. Logs/actions contain allowlisted classifications and redacted identifiers only.

The current menu declares `services/multilogin.png`, but the package installs no matching icon. Phase 7 removes the dangling icon property; the accepted UI/menu test rejects any unresolved icon path.

`/etc/multilogin/quick_setup.sh <base_interface> <count>` remains a package-managed compatibility CLI in v3. Phase 7 converts it to a thin caller of the owned network transaction, preserves exit `0` success/`1` failure, emits the standard non-secret envelope, and never independently edits UCI.

## 8. Managed and Custom state machine

Default mode is Managed. State mutations are locked, generation-numbered, journaled, and committed by atomic rename.

- Raw source is fixed to `https://raw.githubusercontent.com/Zesuy/luci-app-multi-login/main/etc/multilogin/cqu-portal.sh`.
- Check/stage never activates or executes candidate code. Stage enforces HTTPS, exact host/repository/branch/path, redirect policy, byte/time limits, free space, regular-file rules, static API/version metadata, SHA-256, and `sh -n`.
- No enforceable shell sandbox is assumed on supported OpenWrt. `script_validate` therefore first repeats all static acceptance checks, then treats candidate/custom `self-test` as execution of arbitrary root code: it requires an explicit root-code warning/confirmation, `confirm_execute=true`, and the exact staged hash/generation. Unattended development verifies only syntax, metadata, and the validation decision logic; executable validation is a Phase 9/manual-boundary action. A syntax-only candidate or draft remains `staged` or `draft`, not `validated`.
- Activate is always an explicit RPC action originating from a second user confirmation and accepts only a hash-matched `validated` candidate/draft. It snapshots active to the transaction backup, writes the journal, atomically replaces active, rechecks version/self-test and status when an instance is available, then rotates the previous active into LKG and commits state. Failure restores the transaction backup without changing LKG/state; failed restoration retains the recovery journal and backup.
- Managed downgrade (candidate version lower than active) requires an explicit `allow_downgrade=true` confirmation plus a matching expected candidate hash; it is never automatic.
- Restore copies the package factory script through the same validation/activation transaction. Rollback copies LKG through that transaction.
- Custom save changes only `custom.draft.sh` and requires the caller's base hash/generation. Validation does not activate. Custom activation requires explicit confirmation and switches mode only after the common transaction passes.
- A managed candidate may be staged while Custom is active, but it cannot overwrite the custom draft/preserved copy. Activating it explicitly switches to Managed.
- If no configured interface exists, activation records status validation as `skipped_no_instance`; self-test remains mandatory. Real status validation is repeated during Phase 9.

## 9. Package migration and service-state contract

### 9.1 Upgrade classification

Phase 4 recognizes exact stock hashes recorded by the deterministic baseline. Before unpack, `preinst` locks and records:

- package/source version and migration generation;
- init enabled marker and whether a daemon is running;
- hashes, modes, and copies of legacy action/template files;
- free-space result and transaction state.

Migration states are `prepared`, `unpacked`, `classified`, `installed`, `service_restored`, and `complete`. Re-entry resumes or safely repeats the current state.

- Exact known stock scripts migrate to Managed and are not treated as user customizations.
- Any unknown hash is preserved under the root-only migration directory with its original name/hash/mode and recorded as inactive Custom material.
- Unknown code is never sourced, validated by execution, or activated during package installation.
- Failure before active replacement leaves v2 working; failure after replacement uses the journal/factory/LKG to leave a valid v3 active script. No step discards the only copy of unknown content.

### 9.2 Service behavior

- A fresh live install retains v2's init-registration behavior: enable the init service, do not force-start it, and leave `global.enabled=0` by default. An `IPKG_INSTROOT` install performs no live service calls.
- Upgrade preserves the pre-install enabled and running states independently. It restarts only if the service was running; it never turns a previously disabled/stopped installation on.
- A failed/interrupted upgrade restores or records enough state for idempotent recovery before starting the daemon.
- Package removal stops/disables the service. Upgrade/downgrade removal paths preserve the captured state for the incoming version.

### 9.3 Supported downgrade

The sole supported v2 downgrade target is `luci-app-multilogin 2.2.0-4` built from source commit `fb272e8285c65415dea8a9a359a4204b94be06a0`. No baseline IPK or matching tag exists in the repository, so Phase 0 pins source identity rather than claiming a nonexistent binary SHA. Phase 4 verifies the pinned hashes, hooks, and migration decision logic without emulating opkg; Phase 8 records the reproducible artifact name and SHA-256; Phase 9 performs the real lifecycle check.

V3 marks `/etc/config/multilogin` as a conffile and also copies it, modes, script state, and independent init-enabled/daemon-running flags into `/etc/multilogin/.migration-v3/downgrade-state/` before downgrade unpack. That root-only runtime directory is not a package-owned path and survives replacement by v2.

The single finalization mechanism is `/etc/uci-defaults/99-multilogin-v3-downgrade-finalize`, written atomically by the v3 `prerm` upgrade path with no secrets embedded. After `opkg install --force-downgrade <pinned-2.2.0-4.ipk>` completes, the same script:

1. verifies installed package version `2.2.0-4` and the complete downgrade-state manifest;
2. restores the exact backed-up UCI file and required v2 script modes, while archiving v3 active/state data under the migration directory;
3. runs init `enable` or `disable` according to the captured flag, then `start` or `stop` according to the captured running flag;
4. marks the manifest complete and removes itself only after all checks pass.

The operator runs this exact finalizer immediately after opkg; if interrupted or omitted, OpenWrt executes the same idempotent uci-defaults file on the next boot. Failure retains both script and state for safe rerun. There is no alternative finalizer path.

Downgrade preserves UCI sections/credentials, custom/migration backups, and a recoverable v3 script-state archive; it restores stock v2 action paths/modes and leaves no v3 runtime script active. Downgrades to other versions are untested and reported unsupported rather than guessed.

### 9.4 Package dependency disposition

V2 declares only `+curl +bash` although production code also requires mwan3/jsonfilter and LuCI. V3's target dependency set is `+bash +curl +mwan3 +jsonfilter +luci-base`; Phase 8 verifies exact SDK package names on both supported OpenWrt lines. `luci-app-mwan3` remains optional UI, and `luci-compat` is not required by the JS/rpcd architecture. No dependency is added merely to preserve direct browser file execution, which v3 removes.

## 10. Current surface disposition by phase

| Current surface/problem | Decision | Owner phase |
| --- | --- | ---: |
| Password in controller/rpcd child argv | Remove from controller and existing action launchers before wrappers change; stdin only. | 3 |
| `eval` and predictable controller temp path | Remove; indexed state and `mktemp`. | 3 |
| `login.sh`/`login_huxi.sh` duplicate | Unified core plus wrapper; retire duplicate template. | 2, 4 |
| Obsolete `login_A.sh` HTTP/801 template | Retire stock copy; preserve unknown custom hash inactive. | 4 |
| Wrong logout order/no offline poll | Unified protocol order and bounded polling. | 2 |
| Browser direct script read/write/chmod/exec | Remove; fixed RPC state machine only. | 5, 6 |
| Broad file/UCI/ubus ACL | Narrow to fixed RPC and required non-secret reads. | 6, 7 |
| Browser-readable UCI password | Replace reads with write-only account RPC and `password_set`. | 7 |
| Prefix-based `auto_*` deletion | Exact ownership records plus journal/recovery. | 7 |
| Installed positional `quick_setup.sh` | Keep as a thin owned-transaction compatibility CLI. | 7 |
| Unconditional upgrade enable / no migration | Snapshot, classify, idempotently migrate, restore state. | 4 |
| Placeholder stock account/instance | Remove on fresh v3 install; preserve all upgrade sections. | 4 |
| Missing menu icon and incomplete runtime dependencies | Install/remove icon consistently and declare verified dependencies. | 7, 8 |
| No tests/CI/release validation | Bounded compile/static/pure-logic CI, SDK compilation, artifact metadata, and release-consistency gates. | 1, 8 |
| Obsolete docs and secret-bearing examples | Rewrite to actual v3 flows without credentials. | 7 |

## 11. Human-only acceptance

No Phase 0–8 test uses a real portal/credential/device or mutates a real router's firewall, network, mwan3, service, package, or reboot state; it also does not push/tag/release or execute/activate candidate root code on a device. Automated acceptance is limited to compile/lint/static analysis, read-only artifact inspection, redacted protocol fixtures, pure product logic, and narrow argv/stdin security stubs. OpenWrt/opkg/service/rootfs/network/reboot and local-HTTP emulation are not acceptance gates. Real read-only status, login/logout, install/upgrade/downgrade, Raw validation/activation/rollback, network journal recovery, and soak testing remain Phase 9 checklist items requiring explicit authorization; every deferred item must execute and pass before RC acceptance unless the user explicitly changes this contract first.
