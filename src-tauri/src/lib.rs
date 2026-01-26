//! Pokemon Auto Chess Deluxe
//!
//! Cross-platform native wrapper with performance optimizations.
//! Supports Windows (WebView2) and Linux (WebKitGTK).

pub mod performance;
pub mod commands;

pub use performance::PerformanceMonitor;
