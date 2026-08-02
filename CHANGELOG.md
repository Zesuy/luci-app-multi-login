# Changelog

All notable changes to MultiLogin are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and release entries use the SemVer source version. OpenWrt package archives
append their independent `PKG_RELEASE` build revision; for this candidate the
24.10 SDK emits `3.0.0-rc.1-r6` and the APK-based 25.12 SDK emits
`3.0.0_rc1-r6`. The APK spelling is a
deterministic package-manager projection; the source, tag, script, and
changelog version remains `3.0.0-rc.1`.

## [3.0.0-rc.1] - 2026-08-01

### Fixed

- Package revision 6 removes the incompatible global BusyBox `set -u` from
  both JSHN-backed RPC helpers, returns to native OpenWrt JSHN semantics, and
  keeps explicit optional arguments at the application boundary. It also
  checks the native `jshn -r` status before the shell `json_load` wrapper so
  malformed brace-delimited input cannot become an empty request. The bounded
  local/package-scope gate executes the real SDK JSHN library with BusyBox ash
  for normal, missing-field, malformed-input, nested-state, repeated-init, and
  envelope paths.

### Added

- Unified, versioned portal script with fixed Raw update boundaries.
- Managed and Custom script state flows with staged validation and rollback.
- Fixed RPC configuration, diagnostics, and owned-network interfaces.
- Offline release-consistency and archive-inspection tooling.
- A shared SDK matrix that compiles and inspects one 24.10 IPK witness and one
  25.12 APK witness in package-scope CI and before a protected draft release.

### Changed

- Package dependencies now explicitly include `bash`, `curl`, `mwan3`,
  `jsonfilter`, and `luci-base`.
- LuCI uses fixed RPC methods and no longer reads credentials or root scripts.

### Security

- MultiLogin account passwords are stdin-only for portal actions and are not
  returned through browser, RPC, log, or release diagnostics.
