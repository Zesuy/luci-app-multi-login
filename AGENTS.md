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
- For disposable OpenWrt QEMU package/LuCI smoke and screenshots, follow `docs/v3/qemu-luci-smoke-workflow.md`; never treat QEMU evidence as Phase 9 real-device acceptance.
- Never expose passwords in argv, logs, RPC responses, fixtures, diagnostics, or browser-visible UCI data.
- Limit unattended gates to compile/lint/static checks, read-only artifact inspection, and host-independent product logic. Do not build or extend OpenWrt/opkg/procd/UCI/service/network/rootfs/reboot simulations; defer those integration claims to Phase 9.
- Use CodeGraph first for structural code questions; use literal search only for text or non-indexed shell/config files.
- Preserve unrelated user changes and do not rewrite completed phases without evidence of a regression.

## Luna-first workflow overlay

- Use GPT-5.6 Luna Max as the default model for normal coding, analysis, tests, review, and orchestration.
- Use `LUNA_LOCAL` for clear, bounded work; use `LUNA_PARALLEL` only for genuinely independent packets with disjoint writable files and explicit acceptance; use `SOL_ADVISED` only for high-impact ambiguity, architecture/security/data-integrity decisions, or two failed evidence-based attempts.
- Every worker packet must state objective, context, writable scope, out-of-scope files, constraints, acceptance criteria, validation commands, return format, and escalation conditions.
- The primary thread owns integration and final acceptance. Workers must report evidence and must not claim final acceptance.
- Preserve the project-specific v3 phase gate, human-intervention boundary, and no-real-portal/device rules above. The workflow overlay never authorizes push, release, package installation, or device mutation.
