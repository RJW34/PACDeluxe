# Changelog

All notable changes to PACDeluxe will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.6] - 2026-01-13

### Fixed
- Fixed booster page freeze caused by MutationObserver feedback loop

## [1.2.5] - 2026-01-13

### Fixed
- Properly fixed unwanted scrollbar appearing during gameplay (global fix)

## [1.2.4] - 2026-01-10

### Fixed
- Removed unwanted scrollbar that appeared during gameplay (partial fix)
- Fixed Flip All button staying disabled when no packs left

## [1.2.3] - 2026-01-09

### Fixed
- Auto-updater now works correctly (was blocked by CSP in previous versions)
- Users on v1.2.3+ will receive automatic update notifications

## [1.2.2] - 2026-01-09

### Improved
- Booster pack button now dynamically changes text: shows "Flip All" when cards are waiting to be revealed, "Open a Booster" when ready to open a new pack

## [1.2.1] - 2026-01-01

### Added
- Asset caching with version check to prevent stale cache issues
- Automatic cache invalidation when game version changes

### Fixed
- Cache now properly clears when upstream game updates

## [1.2.0] - 2025-12-31

### Added
- Borderless windowed mode for seamless desktop integration
- Improved performance overlay with better positioning
- Window state persistence (remembers size and position)

### Changed
- Overlay now appears in top-right corner by default
- Reduced overlay opacity for less intrusive monitoring

### Fixed
- DPI scaling issues on non-100% displays (reverted problematic fix)

## [1.1.2] - 2025-12-30

### Added
- Auto-updater for seamless app updates
- Installation cleanup on startup (removes old versions)
- Signed update bundles for security

### Fixed
- Update signing configuration for Windows

## [1.1.0] - 2025-12-29

### Added
- Performance monitoring overlay (toggle with Ctrl+Shift+P)
- FPS counter with frame timing histogram
- CPU and memory usage monitoring
- Network RTT (ping) display with jitter tracking
- Asset cache prewarming for faster load times
- WMI-based WebView2 process monitoring
- DPI awareness for crisp rendering on high-DPI displays

### Changed
- Improved RTT measurement accuracy with history tracking

### Fixed
- Auth popup reliability and lifecycle management
- Error logging (replaced silent discards with proper logging)
- HTML5 drag & drop for tier list maker

## [1.0.0] - 2025-12-28

### Added
- Initial release of PACDeluxe
- Native Windows 11 desktop client for Pokemon Auto Chess
- Tauri v2 shell with WebView2
- Google OAuth login support
- System-level performance optimizations:
  - ABOVE_NORMAL_PRIORITY_CLASS for process
  - 1ms timer resolution (timeBeginPeriod)
  - DWM transitions disabled
  - Power throttling disabled
  - WebView2 child process priority elevation
  - Windows 11 DWM optimizations (no rounded corners, no mica)

### Known Limitations
- WebAuthn/Passkeys not supported in WebView2 (use password login)
- Auth popup doesn't auto-close after login
- GPU monitoring not available (requires vendor-specific SDKs)

[Unreleased]: https://github.com/RJW34/PACDeluxe/compare/v1.2.6...HEAD
[1.2.6]: https://github.com/RJW34/PACDeluxe/compare/v1.2.5...v1.2.6
[1.2.5]: https://github.com/RJW34/PACDeluxe/compare/v1.2.4...v1.2.5
[1.2.4]: https://github.com/RJW34/PACDeluxe/compare/v1.2.3...v1.2.4
[1.2.3]: https://github.com/RJW34/PACDeluxe/compare/v1.2.2...v1.2.3
[1.2.2]: https://github.com/RJW34/PACDeluxe/compare/v1.2.1...v1.2.2
[1.2.1]: https://github.com/RJW34/PACDeluxe/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/RJW34/PACDeluxe/compare/v1.1.2...v1.2.0
[1.1.2]: https://github.com/RJW34/PACDeluxe/compare/v1.1.0...v1.1.2
[1.1.0]: https://github.com/RJW34/PACDeluxe/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/RJW34/PACDeluxe/releases/tag/v1.0.0
