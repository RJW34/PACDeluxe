# Performance Tuning Notes

PACDeluxe performance behavior currently lives in two places:

- `src-tauri/src/performance.rs` for native system tuning and telemetry
- `src-tauri/src/main.rs` for the injected in-app overlay/runtime behavior

## Native Tuning Areas

- process priority
- timer resolution
- power-throttling control
- window optimization
- child-process priority handling
- CPU, memory, GPU, and HDR telemetry where supported

## Frontend Runtime Areas

- in-memory asset cache
- performance overlay
- fullscreen and borderless controls
- viewport fixes

## Important Constraint

Performance tuning must remain non-competitive. It must not change gameplay logic, reveal hidden state, or automate gameplay decisions.
