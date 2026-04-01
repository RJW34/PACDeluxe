# Ethics and Compliance Statement

## PACDeluxe Fair-Play Commitments

PACDeluxe is allowed to improve delivery, performance visibility, and non-competitive UI convenience. It is not allowed to change competitive gameplay behavior.

## Non-Negotiable Constraints

- No hidden-state access
- No opponent-only information exposure
- No RNG manipulation
- No timing-rule manipulation
- No gameplay automation
- No packet forgery or network-message tampering
- No bypass of server-authoritative gameplay checks

All gameplay logic remains server-authoritative.

## Allowed Scope

PACDeluxe may implement:

- local asset delivery
- system-performance tuning
- performance telemetry
- window-management features
- updater UX
- non-competitive booster/profile convenience
- auth/session recovery behavior

These features must not reveal hidden game information or automate gameplay decisions.

## Validation Scope

Current verification consists of:

1. ethical safeguard tests over PACDeluxe-owned source
2. build-manifest verification
3. validation harness scanning PACDeluxe-owned runtime/build code
4. optional replay comparison when replay fixtures exist

Important limitation:

Replay comparison is not currently complete unless files are present under `validation/replays/`.

## Build-Time Patch Policy

All upstream patches must be:

- non-gameplay
- idempotent
- documented in `docs/PATCH_MANIFEST.md`
- implemented in `scripts/build-frontend.js`

Undocumented upstream patches are not allowed.

## Network Policy

PACDeluxe may proxy a limited allowlist of upstream HTTP endpoints needed for the local-build client to function.

That proxy must remain:

- allowlisted
- documented in `scripts/proxy-manifest.js`
- non-gameplay
- incapable of modifying competitive state or server-authoritative outcomes

## Transparency

See:

- `TRANSPARENCY.md`
- `docs/PATCH_MANIFEST.md`
- `docs/ADR-0001-local-build-architecture.md`

Last updated: 2026-04-01
