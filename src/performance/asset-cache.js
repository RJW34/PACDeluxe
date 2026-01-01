/**
 * Asset Cache
 *
 * Provides transparent caching for game assets by intercepting fetch() calls.
 * Caches static assets (images, JSON, audio) to reduce network requests.
 *
 * CRITICAL: This cache ONLY stores assets.
 * It does NOT modify, intercept, or manipulate game data.
 */

/**
 * @typedef {Object} CacheStats
 * @property {number} totalAssets
 * @property {number} cachedAssets
 * @property {number} totalBytes
 * @property {number} hitRate
 * @property {number} missCount
 */

/**
 * @typedef {Object} CacheEntry
 * @property {string} key
 * @property {Response} response
 * @property {number} size
 * @property {number} lastAccess
 * @property {number} accessCount
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
    /** @type {Map<string, CacheEntry>} */
    this.cache = new Map();

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
    };
  }

  /**
   * Initialize the cache and install fetch interceptor
   * @param {Object} options
   */
  async init(options = {}) {
    if (this.isInitialized) {
      console.warn('[AssetCache] Already initialized');
      return;
    }

    if (options.maxSizeMB) {
      this.maxSizeBytes = options.maxSizeMB * 1024 * 1024;
    }

    // Install fetch interceptor
    this.installFetchInterceptor();

    this.isInitialized = true;
    console.log(`[AssetCache] Initialized with ${this.maxSizeBytes / 1024 / 1024} MB limit`);
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
   * Get an asset from cache
   * @param {string} key
   * @returns {Response|null}
   */
  get(key) {
    const entry = this.cache.get(key);

    if (entry) {
      entry.lastAccess = Date.now();
      entry.accessCount++;
      return entry.response;
    }

    return null;
  }

  /**
   * Store a response in cache
   * @param {string} key
   * @param {Response} response
   */
  async set(key, response) {
    try {
      // Get response size from content-length or estimate
      const contentLength = response.headers.get('content-length');
      const size = contentLength ? parseInt(contentLength, 10) : 50000; // 50KB default estimate

      // Evict if necessary
      while (this.currentSizeBytes + size > this.maxSizeBytes && this.cache.size > 0) {
        this.evictLRU();
      }

      // Don't cache if single item exceeds limit
      if (size > this.maxSizeBytes) {
        console.warn(`[AssetCache] Asset too large to cache: ${key} (${size} bytes)`);
        return;
      }

      const entry = {
        key,
        response,
        size,
        lastAccess: Date.now(),
        accessCount: 1,
      };

      this.cache.set(key, entry);
      this.currentSizeBytes += size;
    } catch (error) {
      console.warn('[AssetCache] Failed to cache:', key, error);
    }
  }

  /**
   * Evict the least recently used entry
   * @returns {boolean}
   */
  evictLRU() {
    let oldest = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache) {
      if (entry.lastAccess < oldestTime) {
        oldest = key;
        oldestTime = entry.lastAccess;
      }
    }

    if (oldest) {
      const entry = this.cache.get(oldest);
      this.currentSizeBytes -= entry.size;
      this.cache.delete(oldest);
      this.stats.evictions++;
      return true;
    }

    return false;
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
    };
  }

  /**
   * Clear the cache
   */
  clear() {
    this.cache.clear();
    this.currentSizeBytes = 0;
    this.stats = { hits: 0, misses: 0, evictions: 0, bypassed: 0 };
    console.log('[AssetCache] Cache cleared');
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
