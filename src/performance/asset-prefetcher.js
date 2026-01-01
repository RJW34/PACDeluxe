/**
 * CHUNGUS MODE: Predictive Asset Prefetcher
 * Preloads assets for upcoming game phases during idle time
 */

// Asset patterns needed for each game phase
const PHASE_ASSET_PATTERNS = {
    // Picking phase - need shop and champion assets
    pick: [
        '/assets/avatar',
        '/assets/emotions',
        '/assets/item',
        '/assets/types',
    ],
    // Battle phase - need ability and effect assets
    fight: [
        '/assets/abilities',
        '/assets/attacks',
        '/assets/status',
    ],
    // Carousel/minigame phases
    minigame: [
        '/assets/item',
        '/assets/portal',
    ],
};

// Map of phase transitions (current -> next likely phases)
const PHASE_TRANSITIONS = {
    'pick': ['fight'],
    'fight': ['pick', 'minigame'],
    'minigame': ['pick'],
};

export class AssetPrefetcher {
    constructor(assetCache) {
        this.cache = assetCache;
        this.currentPhase = null;
        this.prefetchedUrls = new Set();
        this.isEnabled = true;
        this.observer = null;
        this.prefetchQueue = [];
        this.isPrefetching = false;
    }

    /**
     * Initialize the prefetcher and start monitoring game state
     */
    init() {
        this.setupGameStateObserver();
        console.log('[Chungus Prefetcher] Initialized');
        return this;
    }

    /**
     * Monitor DOM for game phase changes
     */
    setupGameStateObserver() {
        // Watch for phase indicator elements in the game UI
        this.observer = new MutationObserver((mutations) => {
            this.detectPhaseChange();
        });

        // Start observing once game container exists
        const startObserving = () => {
            const gameContainer = document.querySelector('#game') ||
                                  document.querySelector('.game-container') ||
                                  document.body;

            this.observer.observe(gameContainer, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['class', 'data-phase'],
            });
        };

        if (document.readyState === 'complete') {
            startObserving();
        } else {
            window.addEventListener('load', startObserving);
        }
    }

    /**
     * Detect current game phase from DOM state
     */
    detectPhaseChange() {
        let detectedPhase = null;

        // Try to detect phase from various UI indicators
        const phaseIndicators = {
            'pick': ['.shop-container', '.nes-container.shop', '[class*="shop"]'],
            'fight': ['.battle-indicator', '[class*="fight"]', '[class*="battle"]'],
            'minigame': ['.carousel', '.minigame', '[class*="carousel"]'],
        };

        for (const [phase, selectors] of Object.entries(phaseIndicators)) {
            for (const selector of selectors) {
                if (document.querySelector(selector)) {
                    detectedPhase = phase;
                    break;
                }
            }
            if (detectedPhase) break;
        }

        if (detectedPhase && detectedPhase !== this.currentPhase) {
            this.onPhaseChange(detectedPhase);
        }
    }

    /**
     * Handle phase transition - queue prefetch for next phases
     */
    onPhaseChange(newPhase) {
        const previousPhase = this.currentPhase;
        this.currentPhase = newPhase;

        console.log(`[Chungus Prefetcher] Phase: ${previousPhase} -> ${newPhase}`);

        if (!this.isEnabled) return;

        // Get likely next phases
        const nextPhases = PHASE_TRANSITIONS[newPhase] || [];

        // Queue assets for prefetching
        nextPhases.forEach(nextPhase => {
            const patterns = PHASE_ASSET_PATTERNS[nextPhase] || [];
            patterns.forEach(pattern => {
                this.queuePrefetch(pattern);
            });
        });

        // Start prefetching during idle time
        this.schedulePrefetch();
    }

    /**
     * Add URL pattern to prefetch queue
     */
    queuePrefetch(urlPattern) {
        if (!this.prefetchQueue.includes(urlPattern)) {
            this.prefetchQueue.push(urlPattern);
        }
    }

    /**
     * Schedule prefetching during browser idle time
     */
    schedulePrefetch() {
        if (this.isPrefetching || this.prefetchQueue.length === 0) return;

        const prefetchTask = (deadline) => {
            this.isPrefetching = true;

            while (this.prefetchQueue.length > 0 && deadline.timeRemaining() > 5) {
                const pattern = this.prefetchQueue.shift();
                this.prefetchPattern(pattern);
            }

            this.isPrefetching = false;

            // Continue if more items in queue
            if (this.prefetchQueue.length > 0) {
                requestIdleCallback(prefetchTask, { timeout: 3000 });
            }
        };

        if ('requestIdleCallback' in window) {
            requestIdleCallback(prefetchTask, { timeout: 3000 });
        } else {
            // Fallback for older browsers
            setTimeout(() => prefetchTask({ timeRemaining: () => 50 }), 100);
        }
    }

    /**
     * Prefetch assets matching a URL pattern
     */
    async prefetchPattern(urlPattern) {
        // Generate likely asset URLs based on pattern
        // This is a simplified version - in production, use an asset manifest
        const baseUrl = window.location.origin;
        const testUrls = [
            `${baseUrl}${urlPattern}`,
        ];

        for (const url of testUrls) {
            if (this.prefetchedUrls.has(url)) continue;

            try {
                // Use link preload for browser-level optimization
                const link = document.createElement('link');
                link.rel = 'prefetch';
                link.href = url;
                link.as = this.getAssetType(url);
                document.head.appendChild(link);

                this.prefetchedUrls.add(url);
            } catch (e) {
                // Silently ignore prefetch failures
            }
        }
    }

    /**
     * Determine asset type from URL for proper prefetch hints
     */
    getAssetType(url) {
        if (/\.(png|jpg|jpeg|gif|webp|svg)$/i.test(url)) return 'image';
        if (/\.(mp3|ogg|wav|m4a)$/i.test(url)) return 'audio';
        if (/\.(json)$/i.test(url)) return 'fetch';
        if (/\.(js)$/i.test(url)) return 'script';
        if (/\.(css)$/i.test(url)) return 'style';
        return 'fetch';
    }

    /**
     * Get prefetcher statistics
     */
    getStats() {
        return {
            enabled: this.isEnabled,
            currentPhase: this.currentPhase,
            prefetchedCount: this.prefetchedUrls.size,
            queueLength: this.prefetchQueue.length,
            isPrefetching: this.isPrefetching,
        };
    }

    /**
     * Enable/disable prefetching
     */
    setEnabled(enabled) {
        this.isEnabled = enabled;
        console.log(`[Chungus Prefetcher] ${enabled ? 'Enabled' : 'Disabled'}`);
    }

    /**
     * Cleanup
     */
    destroy() {
        if (this.observer) {
            this.observer.disconnect();
        }
        this.prefetchQueue = [];
        this.prefetchedUrls.clear();
    }
}

// Singleton instance
export let assetPrefetcher = null;

/**
 * Create and initialize asset prefetcher
 * @param {Object} assetCache - Optional asset cache instance
 * @returns {AssetPrefetcher}
 */
export function createAssetPrefetcher(assetCache = null) {
    if (!assetPrefetcher) {
        assetPrefetcher = new AssetPrefetcher(assetCache);
    }
    return assetPrefetcher;
}

export default AssetPrefetcher;
