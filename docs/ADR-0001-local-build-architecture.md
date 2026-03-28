# ADR-0001: PACDeluxe Remains a Local-Build Desktop Client

Date: 2026-03-27

## Status

Accepted

## Decision

PACDeluxe will continue as a local-build desktop client rather than reverting to a thin live-site wrapper.

## Why

- The project already bundles upstream assets and patches them at build time.
- The desktop shell adds native windowing, updater, telemetry, and system-performance features that are easier to support in a real desktop-client model.
- Reverting to a wrapper would reduce maintenance in some areas, but it would also discard the 2.0 architecture work instead of stabilizing it.

## Consequences

- The repo must own a safe, explicit upstream network boundary instead of relying on browser-security bypasses.
- Build inputs must be explicit and reproducible.
- Runtime and documentation must describe the local-build architecture truthfully.
- Windows is the only released platform until Linux passes equivalent validation.

