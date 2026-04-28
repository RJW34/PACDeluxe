(function() {
    if (!window.opener) {
        window.opener = {
            postMessage: function(data, targetOrigin) {
                try {
                    if (window.__TAURI__ && window.__TAURI__.event && window.__TAURI__.event.emit) {
                        window.__TAURI__.event.emit('pac-auth-popup-result', {
                            data: data,
                            origin: window.location.origin
                        });
                        console.log('[PACDeluxe Auth Bridge] Forwarded popup->main postMessage');
                    } else {
                        console.warn('[PACDeluxe Auth Bridge] Tauri event API not available');
                    }
                } catch(e) {
                    console.error('[PACDeluxe Auth Bridge] Failed to emit popup->main:', e);
                }
            },
            close: function() {
                try { window.close(); } catch(_e) {}
            },
            closed: false,
            focus: function() {},
            blur: function() {},
            location: {
                href: '',
                replace: function(newUrl) {
                    // Upstream index.tsx calls this when the popup loads a
                    // page that runs the main bundle (e.g. post-auth redirect
                    // to /lobby). In the local-build runtime the main window
                    // must not navigate externally - just inform the main
                    // side that auth is done so it can close the popup.
                    try {
                        if (window.__TAURI__ && window.__TAURI__.event && window.__TAURI__.event.emit) {
                            window.__TAURI__.event.emit('pac-popup-redirect-opener', { url: newUrl });
                        }
                    } catch(_e) {}
                }
            }
        };
        console.log('[PACDeluxe Auth Bridge] window.opener mock installed');
    }

    // Main -> popup MessageEvent dispatch is performed by the Rust side
    // via webview.eval() (see the pac-main-to-popup handler in main.rs).
    // That avoids registering a fresh JS listener on every cross-origin
    // navigation the popup performs during OAuth, which would otherwise
    // accumulate zombie handlers on the Rust event bus.
})();
