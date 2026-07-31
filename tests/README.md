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
