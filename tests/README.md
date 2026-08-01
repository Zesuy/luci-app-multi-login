# Offline test foundation

Run the complete suite from the repository root:

```sh
tests/run.sh
```

The runner is deterministic and uses only repository files, temporary directories,
and PATH-injected command doubles. It never contacts the portal or changes host
network, service, firewall, mwan3, or UCI state.

BusyBox `ash`, ShellCheck, and shfmt are used when installed. A local run prints an
explicit `SKIP` when one is unavailable. CI, or a local run with
`MULTILOGIN_REQUIRE_TOOLING=1`, requires all three tools.

`tests/fixtures/portal/manifest.json` describes the redacted JSONP corpus. The
mock dispatcher records arguments as NUL-delimited bytes and records standard
input only as a byte count and SHA-256 digest. A command must be explicitly
allowed and network-facing doubles also require a scripted response.

`tests/allowlists/legacy-unsafe-patterns.txt` freezes known v2 findings by a hash
of the matching source line. Missing entries are allowed so the list can shrink;
new or changed findings fail the suite. Never add an entry for v3 code merely to
make a check pass.

Phase 2 portal tests run `cqu-portal.sh` as a black box. They synthesize all
interface and JSONP data, reject direct network commands, inspect each live curl
config synchronously, and retain only redacted metadata and secret hashes. The
suite covers the action/exit contract, exact request sequence and parameters,
bounded polling, multi-record identity selection, signal cleanup, and concurrent
temporary-file isolation.

Phase 7 checks are source/static and pure-policy only: fixed RPC schemas and
envelopes, write-only account responses, redaction predicates, token/request
validation, deterministic ownership plans and journal decisions, ACL/menu
negative grants, and credential-free product documentation. They do not invoke
rpcd, UCI, services, network commands, browsers, or a router filesystem.

Phase 8 adds pinned-workflow and release-metadata checks, a pure change-scope
matrix, and a shell-only gate that requires a newer SemVer without changing
script API 3. Ordinary CI does not compile packages; the separate manual release
validation workflow compiles 23.05/24.10 IPKs and a 25.12 APK after the same
code gate passes. Read-only prepared IPK/APK fixtures enforce exact dependency
and payload manifests, file modes, release-line filenames, checksums, and APK
lifecycle-script embedding, including negative extra-file/dependency cases.
They are never installed or executed, and no QEMU/router behavior is emulated.
