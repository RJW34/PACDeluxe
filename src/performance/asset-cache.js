/**
 * Asset Cache
 *
 * Provides advanced asset caching for maximum performance.
 * Preloads and caches game assets to prevent mid-game loading.
 *
 * CRITICAL: This cache ONLY stores assets.
 * It does NOT modify, intercept, or manipulate game data.
 */

import { tauriBridge } from '../bridge/tauri-bridge.js';

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
 * @property {any} data
 * @property {number} size
 * @property {number} lastAccess
 * @property {number} accessCount
 */

export class AssetCache {
  constructor() {
    /** @type {Map<string, CacheEntry>} */
    this.cache = new Map();

    /** @type {number} */
    this.maxSizeBytes = 512 * 1024 * 1024; // 512 MB default

    /** @type {number} */
    this.currentSizeBytes = 0;

    // Statistics
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
    };

    // Asset categories for priority preloading
    this.categories = {
      critical: [], // Must be loaded before game start
      high: [],     // Should be loaded during loading screen
      normal: [],   // Load in background
      low: [],      // Load on demand
    };
  }

  /**
   * Initialize the cache
   * @param {Object} options
   */
  async init(options = {}) {
    if (options.maxSizeMB) {
      this.maxSizeBytes = options.maxSizeMB * 1024 * 1024;
    }

    console.log(`[AssetCache] Initialized with ${this.maxSizeBytes / 1024 / 1024} MB limit`);

    // Register with IndexedDB for persistence
    await this.initIndexedDB();
  }

  /**
   * Initialize IndexedDB for persistent caching
   */
  async initIndexedDB() {
    return new Promise((resolve, _reject) => {
      const request = indexedDB.open('pac-asset-cache', 1);

      request.onerror = () => {
        console.warn('[AssetCache] IndexedDB not available');
        resolve();
      };

      request.onsuccess = () => {
        this.db = request.result;
        console.log('[AssetCache] IndexedDB initialized');
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('assets')) {
          db.createObjectStore('assets', { keyPath: 'key' });
        }
      };
    });
  }

  /**
   * Get an asset from cache
   * @param {string} key
   * @returns {any|null}
   */
  get(key) {
    const entry = this.cache.get(key);

    if (entry) {
      entry.lastAccess = Date.now();
      entry.accessCount++;
      this.stats.hits++;
      return entry.data;
    }

    this.stats.misses++;
    return null;
  }

  /**
   * Store an asset in cache
   * @param {string} key
   * @param {any} data
   * @param {number} [size]
   */
  set(key, data, size) {
    const entrySize = size || this.estimateSize(data);

    // Evict if necessary
    while (this.currentSizeBytes + entrySize > this.maxSizeBytes) {
      if (!this.evictLRU()) {
        console.warn('[AssetCache] Cannot evict enough space');
        return false;
      }
    }

    const entry = {
      key,
      data,
      size: entrySize,
      lastAccess: Date.now(),
      accessCount: 1,
    };

    this.cache.set(key, entry);
    this.currentSizeBytes += entrySize;

    return true;
  }

  /**
   * Estimate the size of data in bytes
   * @param {any} data
   * @returns {number}
   */
  estimateSize(data) {
    if (data instanceof ArrayBuffer) {
      return data.byteLength;
    }
    if (data instanceof Blob) {
      return data.size;
    }
    if (typeof data === 'string') {
      return data.length * 2; // UTF-16
    }
    if (data instanceof ImageBitmap) {
      return data.width * data.height * 4; // RGBA
    }
    // Rough estimate for objects
    return JSON.stringify(data).length * 2;
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
   * Preload a list of assets
   * @param {string[]} urls
   * @param {Object} options
   * @returns {Promise<Object>}
   */
  async preload(urls, options = {}) {
    const { priority = 'normal', onProgress } = options;
    const results = { loaded: 0, failed: 0, total: urls.length };

    console.log(`[AssetCache] Preloading ${urls.length} assets (priority: ${priority})`);

    // Use native preloader if available
    if (tauriBridge.hasNativeFeatures()) {
      const nativeResult = await tauriBridge.preloadAssets(urls);
      if (nativeResult) {
        console.log(`[AssetCache] Native preload: ${nativeResult.loaded_count} assets`);
      }
    }

    // Web preload
    const batchSize = priority === 'critical' ? 1 : 5;

    for (let i = 0; i < urls.length; i += batchSize) {
      const batch = urls.slice(i, i + batchSize);

      await Promise.all(batch.map(async (url) => {
        try {
          const response = await fetch(url);
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          const contentType = response.headers.get('content-type') || '';
          let data;

          if (contentType.includes('image')) {
            const blob = await response.blob();
            data = await createImageBitmap(blob);
          } else if (contentType.includes('audio')) {
            data = await response.arrayBuffer();
          } else if (contentType.includes('json')) {
            data = await response.json();
          } else {
            data = await response.text();
          }

          this.set(url, data);
          results.loaded++;
        } catch (error) {
          console.warn(`[AssetCache] Failed to preload: ${url}`, error);
          results.failed++;
        }

        if (onProgress) {
          onProgress(results.loaded + results.failed, results.total);
        }
      }));
    }

    console.log(`[AssetCache] Preload complete: ${results.loaded}/${results.total}`);
    return results;
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
    };
  }

  /**
   * Clear the cache
   */
  clear() {
    this.cache.clear();
    this.currentSizeBytes = 0;
    console.log('[AssetCache] Cache cleared');
  }

  /**
   * Warm the cache with commonly used assets
   * @param {string[]} assetUrls - Optional specific URLs to warm
   */
  async warmCache(assetUrls = []) {
    // If specific URLs provided, preload those
    if (assetUrls.length > 0) {
      console.log(`[AssetCache] Warming cache with ${assetUrls.length} specific assets...`);
      return this.preload(assetUrls, { priority: 'high' });
    }

    // Otherwise try to discover and preload common assets
    console.log('[AssetCache] Warming cache with common assets...');

    // Try to fetch asset manifest if available
    try {
      const manifestResponse = await fetch('/assets/manifest.json');
      if (manifestResponse.ok) {
        const manifest = await manifestResponse.json();
        if (manifest.preload && Array.isArray(manifest.preload)) {
          console.log(`[AssetCache] Found ${manifest.preload.length} assets in manifest`);
          return this.preload(manifest.preload, { priority: 'critical' });
        }
      }
    } catch {
      // No manifest available, continue with discovery
    }

    // Discover critical assets by checking for common Phaser asset patterns
    const discoveredAssets = [];

    // Common asset paths in Pokemon Auto Chess (based on upstream structure)
    const assetPatterns = [
      '/assets/ui/',
      '/assets/pokemons/',
      '/assets/types/',
      '/assets/items/',
      '/assets/abilities/',
      '/tilesets/'
    ];

    // Try to find atlas files (JSON + PNG pairs are critical for Phaser)
    for (const pattern of assetPatterns) {
      try {
        // Try common atlas naming conventions
        const atlasNames = ['atlas', 'spritesheet', 'sprites'];
        for (const name of atlasNames) {
          const jsonUrl = `${pattern}${name}.json`;
          const response = await fetch(jsonUrl, { method: 'HEAD' });
          if (response.ok) {
            discoveredAssets.push(jsonUrl);
            // Also queue the corresponding PNG
            discoveredAssets.push(jsonUrl.replace('.json', '.png'));
          }
        }
      } catch {
        // Asset doesn't exist at this path, continue
      }
    }

    if (discoveredAssets.length > 0) {
      console.log(`[AssetCache] Discovered ${discoveredAssets.length} assets to preload`);
      return this.preload(discoveredAssets, { priority: 'high' });
    }

    console.log('[AssetCache] No assets discovered, cache will populate on demand');
    return { loaded: 0, failed: 0, total: 0 };
  }
}

// Singleton instance
export const assetCache = new AssetCache();

// Auto-initialize
if (typeof window !== 'undefined') {
  assetCache.init().catch(console.error);
}
