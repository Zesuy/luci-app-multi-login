# Changelog

All notable changes to MultiLogin are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and release entries use the SemVer source version. OpenWrt package archives
append their independent `PKG_RELEASE` build revision; for this candidate the
23.05 SDK emits `3.0.0-rc.1-1` and the 24.10 SDK emits `3.0.0-rc.1-r1`.

## [3.0.0-rc.1] - 2026-08-01

### Added

- Unified, versioned portal script with fixed Raw update boundaries.
- Managed and Custom script state flows with staged validation and rollback.
- Fixed RPC configuration, diagnostics, and owned-network interfaces.
- Offline release-consistency and archive-inspection tooling.

### Changed

- Package dependencies now explicitly include `bash`, `curl`, `mwan3`,
  `jsonfilter`, and `luci-base`.
- LuCI uses fixed RPC methods and no longer reads credentials or root scripts.

### Security

- MultiLogin account passwords are stdin-only for portal actions and are not
  returned through browser, RPC, log, or release diagnostics.
