# Repository Agent Instructions

## MultiLogin v3 work

- Before changing v3 code, read `dev/plan/multilogin-v3.md` completely.
- Work on only the current phase. Do not start the next phase until its acceptance gate passes.
- Use the plan state machine and record each phase's scope, tests, decisions, risks, and accepted commit in the progress log.
- A subagent that implemented a phase must not be its final reviewer; the independent reviewer returns `PASS` or `BLOCK` against the phase gate.
- `PASS-AUTOMATED` may defer only actions forbidden by the plan's human-intervention boundary; never defer a locally testable gate item.
- After a phase, update the plan status and record tests, important decisions, and remaining risks.
- Preserve the existing UCI schema, CLI flags, and exit codes unless the plan explicitly changes them.
- Keep `login_control.bash` package-managed. GitHub Raw updates may replace only `cqu-portal.sh`.
- Never run a real portal login or logout without explicit user authorization. Read-only status checks are allowed.
- For the current unattended run, keep all portal/device checks offline until Phase 9, as required by the execution plan.
- Never expose passwords in argv, logs, RPC responses, fixtures, diagnostics, or browser-visible UCI data.
- Limit unattended gates to compile/lint/static checks, read-only artifact inspection, and host-independent product logic. Do not build or extend OpenWrt/opkg/procd/UCI/service/network/rootfs/reboot simulations; defer those integration claims to Phase 9.
- Use CodeGraph first for structural code questions; use literal search only for text or non-indexed shell/config files.
- Preserve unrelated user changes and do not rewrite completed phases without evidence of a regression.
