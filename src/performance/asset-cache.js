/**
 * Asset Cache
 *
 * Provides transparent caching for game assets by intercepting fetch() calls.
 * Caches static assets (images, JSON, audio) to reduce network requests.
 *
 * Uses O(1) LRU eviction via doubly-linked list for optimal performance.
 *
 * Features:
 * - Smart version detection: clears stale assets when game updates
 * - Discovered assets persistence: remembers assets for faster prewarm
 * - Auto-prewarm: loads known assets on startup
 *
 * CRITICAL: This cache ONLY stores assets.
 * It does NOT modify, intercept, or manipulate game data.
 */

// LocalStorage keys for persistence
const CACHE_VERSION_KEY = '__pac_cache_version__';
const DISCOVERED_ASSETS_KEY = '__pac_discovered_assets__';
const CACHE_STATS_KEY = '__pac_cache_stats__';

/**
 * @typedef {Object} CacheStats
 * @property {number} totalAssets
 * @property {number} cachedAssets
 * @property {number} totalBytes
 * @property {number} hitRate
 * @property {number} missCount
 */

/**
 * Doubly-linked list node for O(1) LRU tracking
 * @typedef {Object} LRUNode
 * @property {string} key
 * @property {Response} response
 * @property {number} size
 * @property {number} accessCount
 * @property {LRUNode|null} prev
 * @property {LRUNode|null} next
 */

// Asset URL patterns to cache (static resources only)
const CACHEABLE_PATTERNS = [
  /\.(png|jpg|jpeg|gif|webp|svg)$/i,  // Images
  /\.(json)$/i,                        // JSON (atlases, configs)
  /\.(mp3|ogg|wav|m4a)$/i,            // Audio
  /\.(woff|woff2|ttf|otf)$/i,         // Fonts
  /\/assets\//i,                       // Anything in /assets/
  /\/tilesets\//i,                     // Tileset data
];

// URLs to never cache (dynamic content)
const NEVER_CACHE_PATTERNS = [
  /\/api\//i,           // API calls
  /firestore/i,         // Firebase
  /firebase/i,          // Firebase
  /colyseus/i,          // Game server
  /socket/i,            // WebSocket
  /\.hot-update\./i,    // HMR updates
  /\?/,                 // URLs with query strings (often dynamic)
];

export class AssetCache {
  constructor() {
    /**
     * Map for O(1) key lookup
     * @type {Map<string, LRUNode>}
     */
    this.cache = new Map();

    /**
     * LRU doubly-linked list head (least recently used)
     * @type {LRUNode|null}
     */
    this.head = null;

    /**
     * LRU doubly-linked list tail (most recently used)
     * @type {LRUNode|null}
     */
    this.tail = null;

    /** @type {number} */
    this.maxSizeBytes = 256 * 1024 * 1024; // 256 MB default

    /** @type {number} */
    this.currentSizeBytes = 0;

    /** @type {boolean} */
    this.isInitialized = false;

    /** @type {Function|null} */
    this.originalFetch = null;

    // Statistics
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      bypassed: 0,
      prewarmed: 0,
      prewarmFailed: 0,
    };

    // Prewarm state
    this.isPrewarming = false;
    this.prewarmProgress = { total: 0, completed: 0, failed: 0 };
  }

  /**
   * Prewarm the cache with a list of asset URLs
   * Fetches assets in the background using requestIdleCallback for non-blocking operation
   * @param {string[]} urls - Array of asset URLs to prewarm
   * @param {Object} options - Prewarm options
   * @param {number} options.concurrency - Max concurrent fetches (default: 3)
   * @param {Function} options.onProgress - Progress callback
   * @returns {Promise<{success: number, failed: number, skipped: number}>}
   */
  async prewarm(urls, options = {}) {
    if (!this.isInitialized) {
      console.warn('[AssetCache] Cannot prewarm: cache not initialized');
      return { success: 0, failed: 0, skipped: 0 };
    }

    if (this.isPrewarming) {
      console.warn('[AssetCache] Prewarm already in progress');
      return { success: 0, failed: 0, skipped: 0 };
    }

    const { concurrency = 3, onProgress } = options;
    this.isPrewarming = true;

    // Filter to only cacheable URLs not already cached
    const urlsToFetch = urls.filter(url => {
      if (!this.shouldCache(url)) return false;
      if (this.cache.has(url)) return false;
      return true;
    });

    const skipped = urls.length - urlsToFetch.length;
    this.prewarmProgress = { total: urlsToFetch.length, completed: 0, failed: 0 };

    console.log(`[AssetCache] Prewarming ${urlsToFetch.length} assets (${skipped} skipped)`);
    const startTime = performance.now();

    let success = 0;
    let failed = 0;

    // Process in batches for controlled concurrency
    for (let i = 0; i < urlsToFetch.length; i += concurrency) {
      const batch = urlsToFetch.slice(i, i + concurrency);

      // Use requestIdleCallback if available for non-blocking operation
      await new Promise(resolve => {
        const processBatch = async () => {
          const results = await Promise.allSettled(
            batch.map(url => this._prewarmUrl(url))
          );

          results.forEach((result, _idx) => {
            if (result.status === 'fulfilled' && result.value) {
              success++;
              this.stats.prewarmed++;
            } else {
              failed++;
              this.stats.prewarmFailed++;
            }
            this.prewarmProgress.completed++;
            if (result.status === 'rejected') {
              this.prewarmProgress.failed++;
            }
          });

          if (onProgress) {
            onProgress({
              ...this.prewarmProgress,
              percent: Math.round((this.prewarmProgress.completed / this.prewarmProgress.total) * 100),
            });
          }

          resolve();
        };

        if (typeof requestIdleCallback !== 'undefined') {
          requestIdleCallback(processBatch, { timeout: 1000 });
        } else {
          setTimeout(processBatch, 0);
        }
      });
    }

    const duration = Math.round(performance.now() - startTime);
    this.isPrewarming = false;

    console.log(`[AssetCache] Prewarm complete: ${success} success, ${failed} failed, ${skipped} skipped (${duration}ms)`);

    return { success, failed, skipped };
  }

  /**
   * Prewarm a single URL
   * @param {string} url
   * @returns {Promise<boolean>}
   */
  async _prewarmUrl(url) {
    try {
      // Use originalFetch to bypass cache check (we know it's not cached)
      const response = await this.originalFetch(url);

      if (response.ok) {
        await this.set(url, response.clone());
        return true;
      }

      return false;
    } catch (error) {
      console.warn(`[AssetCache] Prewarm failed for: ${url}`, error.message);
      return false;
    }
  }

  /**
   * Get prewarm progress
   * @returns {{total: number, completed: number, failed: number, isPrewarming: boolean}}
   */
  getPrewarmProgress() {
    return {
      ...this.prewarmProgress,
      isPrewarming: this.isPrewarming,
    };
  }

  /**
   * Move a node to the tail (most recently used) - O(1)
   * @param {LRUNode} node
   */
  _moveToTail(node) {
    if (node === this.tail) return; // Already at tail

    // Remove from current position
    this._removeNode(node);

    // Add to tail
    this._addToTail(node);
  }

  /**
   * Remove a node from the linked list - O(1)
   * @param {LRUNode} node
   */
  _removeNode(node) {
    if (node.prev) {
      node.prev.next = node.next;
    } else {
      this.head = node.next;
    }

    if (node.next) {
      node.next.prev = node.prev;
    } else {
      this.tail = node.prev;
    }

    node.prev = null;
    node.next = null;
  }

  /**
   * Add a node to the tail (most recently used) - O(1)
   * @param {LRUNode} node
   */
  _addToTail(node) {
    node.prev = this.tail;
    node.next = null;

    if (this.tail) {
      this.tail.next = node;
    }
    this.tail = node;

    if (!this.head) {
      this.head = node;
    }
  }

  /**
   * Initialize the cache and install fetch interceptor
   * @param {Object} options
   * @param {number} options.maxSizeMB - Maximum cache size in MB
   * @param {boolean} options.autoPrewarm - Whether to auto-prewarm on init (default: true)
   */
  async init(options = {}) {
    if (this.isInitialized) {
      console.warn('[AssetCache] Already initialized');
      return;
    }

    if (options.maxSizeMB) {
      this.maxSizeBytes = options.maxSizeMB * 1024 * 1024;
    }

    // Check build version for cache invalidation
    const versionChanged = this.checkVersion();
    if (versionChanged) {
      console.log('[AssetCache] Game version changed, cache metadata cleared');
    }

    // Install fetch interceptor
    this.installFetchInterceptor();

    this.isInitialized = true;
    console.log(`[AssetCache] Initialized with ${this.maxSizeBytes / 1024 / 1024} MB limit`);

    // Auto-prewarm from discovered assets if available
    const autoPrewarm = options.autoPrewarm !== false;
    if (autoPrewarm && !versionChanged) {
      const discoveredAssets = this.loadDiscoveredAssets();
      if (discoveredAssets.length > 0) {
        console.log(`[AssetCache] Auto-prewarming ${discoveredAssets.length} discovered assets`);
        // Prewarm in background with low priority
        this.prewarm(discoveredAssets, { concurrency: 2 }).catch(err => {
          console.warn('[AssetCache] Auto-prewarm failed:', err);
        });
      }
    }
  }

  /**
   * Check if build version has changed, clear stale data if so
   * @returns {boolean} True if version changed and data was cleared
   */
  checkVersion() {
    const currentVersion = typeof window !== 'undefined'
      ? window.__PAC_BUILD_VERSION__
      : null;

    if (!currentVersion) {
      console.warn('[AssetCache] No build version found, skipping version check');
      return false;
    }

    try {
      const storedVersion = localStorage.getItem(CACHE_VERSION_KEY);

      if (storedVersion !== currentVersion) {
        console.log(`[AssetCache] Version mismatch: ${storedVersion || 'none'} -> ${currentVersion}`);

        // Clear stale discovered assets
        localStorage.removeItem(DISCOVERED_ASSETS_KEY);
        localStorage.removeItem(CACHE_STATS_KEY);

        // Store new version
        localStorage.setItem(CACHE_VERSION_KEY, currentVersion);

        return true;
      }

      console.log(`[AssetCache] Version match: ${currentVersion}`);
      return false;
    } catch (err) {
      console.warn('[AssetCache] localStorage error during version check:', err);
      return false;
    }
  }

  /**
   * Get the current build version
   * @returns {string|null}
   */
  getBuildVersion() {
    return typeof window !== 'undefined' ? window.__PAC_BUILD_VERSION__ : null;
  }

  /**
   * Load discovered assets from localStorage
   * @returns {string[]}
   */
  loadDiscoveredAssets() {
    try {
      const stored = localStorage.getItem(DISCOVERED_ASSETS_KEY);
      if (stored) {
        const assets = JSON.parse(stored);
        if (Array.isArray(assets)) {
          return assets;
        }
      }
    } catch (err) {
      console.warn('[AssetCache] Failed to load discovered assets:', err);
    }
    return [];
  }

  /**
   * Save discovered assets to localStorage for future prewarming
   * @param {string[]} assets
   */
  saveDiscoveredAssets(assets) {
    try {
      // Limit to 500 assets to avoid localStorage quota issues
      const toSave = assets.slice(0, 500);
      localStorage.setItem(DISCOVERED_ASSETS_KEY, JSON.stringify(toSave));
      console.log(`[AssetCache] Saved ${toSave.length} discovered assets for future prewarm`);
    } catch (err) {
      console.warn('[AssetCache] Failed to save discovered assets:', err);
    }
  }

  /**
   * Record currently cached assets for future prewarming
   * Call this after the game has fully loaded
   */
  recordDiscoveredAssets() {
    // Get all URLs we've successfully cached
    const cachedUrls = Array.from(this.cache.keys());

    // Also discover assets from the DOM
    const domAssets = discoverPageAssets();

    // Combine and deduplicate
    const allAssets = [...new Set([...cachedUrls, ...domAssets])];

    // Filter to only cacheable assets
    const cacheableAssets = allAssets.filter(url => this.shouldCache(url));

    this.saveDiscoveredAssets(cacheableAssets);

    return cacheableAssets.length;
  }

  /**
   * Check if a URL should be cached
   * @param {string} url
   * @returns {boolean}
   */
  shouldCache(url) {
    // Never cache these
    for (const pattern of NEVER_CACHE_PATTERNS) {
      if (pattern.test(url)) {
        return false;
      }
    }

    // Cache if matches cacheable patterns
    for (const pattern of CACHEABLE_PATTERNS) {
      if (pattern.test(url)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Install fetch interceptor
   */
  installFetchInterceptor() {
    if (typeof window === 'undefined' || !window.fetch) {
      console.warn('[AssetCache] fetch not available, skipping interceptor');
      return;
    }

    this.originalFetch = window.fetch.bind(window);

    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input.url;

      // Only intercept GET requests for cacheable URLs
      const method = init?.method?.toUpperCase() || 'GET';
      if (method !== 'GET' || !this.shouldCache(url)) {
        this.stats.bypassed++;
        return this.originalFetch(input, init);
      }

      // Check cache first
      const cached = this.get(url);
      if (cached) {
        this.stats.hits++;
        // Clone the response so it can be used multiple times
        return cached.clone();
      }

      // Fetch from network
      this.stats.misses++;
      try {
        const response = await this.originalFetch(input, init);

        // Only cache successful responses
        if (response.ok) {
          // Clone before caching (response body can only be read once)
          const clonedResponse = response.clone();
          this.set(url, clonedResponse);
        }

        return response;
      } catch (error) {
        // On network error, try to return cached version if available
        const fallback = this.get(url);
        if (fallback) {
          console.log(`[AssetCache] Network error, using cached: ${url}`);
          return fallback.clone();
        }
        throw error;
      }
    };

    console.log('[AssetCache] Fetch interceptor installed');
  }

  /**
   * Get an asset from cache - O(1)
   * @param {string} key
   * @returns {Response|null}
   */
  get(key) {
    const node = this.cache.get(key);

    if (node) {
      // Move to tail (most recently used) - O(1)
      this._moveToTail(node);
      node.accessCount++;
      return node.response;
    }

    return null;
  }

  /**
   * Store a response in cache - O(1) amortized
   * @param {string} key
   * @param {Response} response
   */
  async set(key, response) {
    try {
      // Get response size from content-length or estimate
      const contentLength = response.headers.get('content-length');
      const size = contentLength ? parseInt(contentLength, 10) : 50000; // 50KB default estimate

      // Don't cache if single item exceeds limit
      if (size > this.maxSizeBytes) {
        console.warn(`[AssetCache] Asset too large to cache: ${key} (${size} bytes)`);
        return;
      }

      // Evict if necessary - O(1) per eviction
      while (this.currentSizeBytes + size > this.maxSizeBytes && this.cache.size > 0) {
        this.evictLRU();
      }

      // If key already exists, update it
      if (this.cache.has(key)) {
        const existingNode = this.cache.get(key);
        this.currentSizeBytes -= existingNode.size;
        existingNode.response = response;
        existingNode.size = size;
        existingNode.accessCount = 1;
        this._moveToTail(existingNode);
        this.currentSizeBytes += size;
        return;
      }

      // Create new node
      /** @type {LRUNode} */
      const node = {
        key,
        response,
        size,
        accessCount: 1,
        prev: null,
        next: null,
      };

      // Add to cache and linked list
      this.cache.set(key, node);
      this._addToTail(node);
      this.currentSizeBytes += size;
    } catch (error) {
      console.warn('[AssetCache] Failed to cache:', key, error);
    }
  }

  /**
   * Evict the least recently used entry - O(1)
   * Removes from the head of the linked list (oldest)
   * @returns {boolean}
   */
  evictLRU() {
    if (!this.head) {
      return false;
    }

    const node = this.head;

    // Remove from linked list - O(1)
    this._removeNode(node);

    // Remove from map - O(1)
    this.cache.delete(node.key);
    this.currentSizeBytes -= node.size;
    this.stats.evictions++;

    return true;
  }

  /**
   * Get cache statistics
   * @returns {CacheStats}
   */
  getStats() {
    const totalRequests = this.stats.hits + this.stats.misses;

    return {
      totalAssets: this.cache.size,
      cachedAssets: this.cache.size,
      totalBytes: this.currentSizeBytes,
      hitRate: totalRequests > 0 ? this.stats.hits / totalRequests : 0,
      missCount: this.stats.misses,
      hits: this.stats.hits,
      bypassed: this.stats.bypassed,
      evictions: this.stats.evictions,
      prewarmed: this.stats.prewarmed,
      prewarmFailed: this.stats.prewarmFailed,
      isPrewarming: this.isPrewarming,
      buildVersion: this.getBuildVersion(),
      discoveredAssetCount: this.loadDiscoveredAssets().length,
    };
  }

  /**
   * Clear the cache
   * @param {Object} options
   * @param {boolean} options.clearPersisted - Also clear localStorage data (default: false)
   */
  clear(options = {}) {
    this.cache.clear();
    this.head = null;
    this.tail = null;
    this.currentSizeBytes = 0;
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      bypassed: 0,
      prewarmed: 0,
      prewarmFailed: 0,
    };
    this.prewarmProgress = { total: 0, completed: 0, failed: 0 };

    if (options.clearPersisted) {
      this.clearPersistedData();
    }

    console.log('[AssetCache] Cache cleared');
  }

  /**
   * Clear all persisted data from localStorage
   * Use this when you want a complete reset
   */
  clearPersistedData() {
    try {
      localStorage.removeItem(CACHE_VERSION_KEY);
      localStorage.removeItem(DISCOVERED_ASSETS_KEY);
      localStorage.removeItem(CACHE_STATS_KEY);
      console.log('[AssetCache] Persisted data cleared');
    } catch (err) {
      console.warn('[AssetCache] Failed to clear persisted data:', err);
    }
  }

  /**
   * Restore original fetch (for cleanup)
   */
  destroy() {
    if (this.originalFetch && typeof window !== 'undefined') {
      window.fetch = this.originalFetch;
      this.originalFetch = null;
      console.log('[AssetCache] Fetch interceptor removed');
    }
    this.clear();
    this.isInitialized = false;
  }
}

// Singleton instance
export const assetCache = new AssetCache();

/**
 * Critical assets to prewarm for Pokemon Auto Chess
 * These are commonly used assets that benefit from early caching
 * Note: Paths are relative to the game's base URL
 */
export const CRITICAL_ASSETS = [
  // UI Assets
  '/assets/ui/button.png',
  '/assets/ui/panel.png',
  '/assets/ui/icons.png',

  // Common Pokemon sprites (most frequently seen)
  '/assets/pokemons/0001.png', // Bulbasaur
  '/assets/pokemons/0004.png', // Charmander
  '/assets/pokemons/0007.png', // Squirtle
  '/assets/pokemons/0025.png', // Pikachu

  // Battle UI
  '/assets/ui/health-bar.png',
  '/assets/ui/mana-bar.png',
  '/assets/ui/status-icons.png',

  // Audio (most common sounds)
  '/assets/sounds/click.mp3',
  '/assets/sounds/battle-start.mp3',

  // Tilesets
  '/assets/tilesets/grass.png',
  '/assets/tilesets/water.png',

  // Config files
  '/assets/data/pokemon.json',
  '/assets/data/items.json',
  '/assets/data/abilities.json',
];

/**
 * Discover asset URLs from the current page
 * Scans DOM for images, audio, and other cacheable resources
 * @returns {string[]}
 */
export function discoverPageAssets() {
  const assets = new Set();

  // Find all images
  document.querySelectorAll('img[src]').forEach(img => {
    const src = img.src;
    if (src && !src.startsWith('data:')) {
      assets.add(src);
    }
  });

  // Find images in CSS backgrounds (limited detection)
  document.querySelectorAll('[style*="background"]').forEach(el => {
    const style = el.getAttribute('style') || '';
    const match = style.match(/url\(['"]?([^'"()]+)['"]?\)/);
    if (match?.[1] && !match[1].startsWith('data:')) {
      assets.add(match[1]);
    }
  });

  // Find audio elements
  document.querySelectorAll('audio[src], source[src]').forEach(audio => {
    const src = audio.src || audio.getAttribute('src');
    if (src) {
      assets.add(src);
    }
  });

  return Array.from(assets);
}

/**
 * Start prewarming with critical assets plus discovered page assets
 * Call this after the page has loaded and user is in lobby/menu
 * @param {Object} options - Options to pass to prewarm()
 * @param {boolean} options.recordAssets - Save discovered assets for future prewarm (default: true)
 * @returns {Promise<{success: number, failed: number, skipped: number}>}
 */
export async function startPrewarm(options = {}) {
  // Combine critical assets with discovered page assets
  const discoveredAssets = discoverPageAssets();
  const allAssets = [...new Set([...CRITICAL_ASSETS, ...discoveredAssets])];

  console.log(`[AssetCache] Starting prewarm with ${allAssets.length} assets`);
  const result = await assetCache.prewarm(allAssets, options);

  // Record assets for future auto-prewarm (unless disabled)
  if (options.recordAssets !== false) {
    assetCache.recordDiscoveredAssets();
  }

  return result;
}

/**
 * Get cache version info for debugging
 * @returns {Object}
 */
export function getCacheVersionInfo() {
  return {
    buildVersion: window.__PAC_BUILD_VERSION__ || null,
    buildTime: window.__PAC_BUILD_TIME__ || null,
    storedVersion: localStorage.getItem(CACHE_VERSION_KEY),
    discoveredAssetCount: assetCache.loadDiscoveredAssets().length,
  };
}
