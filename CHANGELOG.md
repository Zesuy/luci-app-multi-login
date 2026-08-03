# Changelog

All notable changes to MultiLogin are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and release entries use the SemVer source version. OpenWrt package archives
append their independent `PKG_RELEASE` build revision; for this candidate the
24.10 SDK emits `3.0.0-rc.1-r19` and the APK-based 25.12 SDK emits
`3.0.0_rc1-r19`. The APK spelling is a
deterministic package-manager projection; the source, tag, script, and
changelog version remains `3.0.0-rc.1`.

## [3.0.0-rc.1] - 2026-08-03

### Fixed

- Package revision 19 simplifies the product surface: the dashboard keeps only
  the overall conclusion and blocker warning cards, treats missing network
  resources as non-blocking, and keeps service controls inside the blocker card.
  Managed script updates are now one confirmed check-and-update action; hashes,
  generations, candidate stages, and previous-version rollback details remain
  internal, while the package-built-in restore action stays available.

- Package revision 18 reorganizes the LuCI product flow around four task
  destinations: 仪表盘, 登录管理, 网络资源, and 维护. Service operations are
  centralized on the dashboard; account/task setup, owned-network creation,
  troubleshooting, and script maintenance now use progressive disclosure and
  explicit recovery boundaries. The fixed RPC, UCI, ACL, service, and portal
  contracts remain unchanged.

- Package revision 17 gives all five LuCI views a shared, theme-aware visual
  layer with clearer page hierarchy, status cards, grouped actions, responsive
  tables, compact diagnostic output, and explicit loading/error/empty feedback.
  The visual refactor keeps the fixed RPC surface, UCI persistence, service
  boundaries, and portal safety rules unchanged.

- Package revision 16 anchors optional `v6face` detection to the beginning of
  a complete UCI option line. A valid alias containing the option-like text
  can no longer trigger a false delete and rollback.

- Package revision 15 makes blank `v6face` clearing fail closed using the
  exact section listing. A missing option is a no-op, an existing option must
  be deleted successfully, and section-read/grep/delete errors roll back.

- Package revision 14 makes blank `v6face` clearing fail closed. Only UCI's
  explicit missing-option status is ignored; read or delete errors now roll
  back the locked transaction instead of reporting a false success.

- Package revision 13 treats deletion of an already-absent optional IPv6 UCI
  option as success. The previous instance save path rolled the whole locked
  transaction back when `v6face` was blank on a new instance.

- Package revision 12 wraps the generated-name UCI filters in explicit awk
  actions. BusyBox awk rejects the previous bare `!~` pattern form, which
  caused valid disabled instances to roll back with `configuration write failed`.

- Package revision 11 fixes CR/LF validation in the configuration backend.
  The previous revision constructed its newline pattern with command
  substitution, which strips the trailing newline and rejected every account
  and instance alias before any UCI write. The validator now preserves a
  literal newline and has executable pure-logic regression coverage.

- Package revision 10 preserves upgraded anonymous UCI account/instance
  sections, allocates stable names for new sections, keeps account references
  stable while editing, loads anonymous instances in the controller, and
  reports local portal failures with the valid `internal_error/internal` pair.

- Package revision 9 fixes LuCI 23.05 boolean attribute serialization so idle
  configuration and script-manager controls remain clickable.

- Package revision 8 accepts and validates rpcd's injected
  `ubus_rpc_session` transport metadata before removing it from the exact
  business request schema. This restores LuCI overview and script pages while
  continuing to reject wrong-type metadata and unknown client fields.

- Package revision 7 hides legacy LuCI compatibility aliases on the 23.05
  menu parser, invalidates the generated LuCI menu index after installation,
  declares whole-envelope RPC expectations explicitly, and filters optional
  DOM children before passing them to legacy LuCI appenders. This prevents
  duplicate navigation entries, stale RPC state, and literal `null` text on
  older LuCI builds.

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
