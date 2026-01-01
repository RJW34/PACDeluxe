/**
 * Ethical Safeguards Tests
 *
 * These tests verify that the Pokemon Auto Chess Deluxe client
 * does NOT implement any cheating functionality.
 *
 * CRITICAL: All tests MUST pass before any release.
 * Failure indicates potential cheating functionality that must be removed.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

/**
 * Get all source files recursively
 * @param {string} dir
 * @param {string[]} extensions
 * @returns {string[]}
 */
function getSourceFiles(dir, extensions = ['.js', '.ts', '.rs']) {
  const files = [];

  try {
    const entries = readdirSync(dir);

    for (const entry of entries) {
      const fullPath = join(dir, entry);

      // Skip non-source directories
      const skipDirs = ['node_modules', 'upstream-game', '.git', 'tests', 'target', 'dist', 'scripts', 'docs', 'validation'];
      if (skipDirs.includes(entry)) {
        continue;
      }

      try {
        const stat = statSync(fullPath);

        if (stat.isDirectory()) {
          files.push(...getSourceFiles(fullPath, extensions));
        } else if (extensions.some(ext => entry.endsWith(ext))) {
          files.push(fullPath);
        }
      } catch {
        // Skip files we can't read
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }

  return files;
}

/**
 * Search for forbidden patterns in source code
 * @param {string} content
 * @param {RegExp[]} patterns
 * @returns {Array<{pattern: RegExp, match: string, line: number}>}
 */
function findForbiddenPatterns(content, patterns) {
  const violations = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match) {
        violations.push({
          pattern,
          match: match[0],
          line: i + 1,
        });
      }
    }
  }

  return violations;
}

describe('Ethical Safeguards', () => {
  const sourceFiles = getSourceFiles(ROOT);

  describe('No Cheating Functionality', () => {
    // Patterns that would indicate cheating
    const forbiddenPatterns = [
      // Accessing opponent private data
      /opponent\.private/gi,
      /enemy\.hidden/gi,
      /getOpponentHand/gi,
      /revealHidden/gi,

      // RNG manipulation
      /Math\.random\s*=\s*/gi,
      /overrideRng/gi,
      /seedRandom(?!.*test)/gi,
      /predictRandom/gi,

      // Timing manipulation
      /Date\.now\s*=\s*/gi,
      /performance\.now\s*=\s*/gi,
      /fakeTimestamp/gi,
      /manipulateTiming/gi,

      // Automated gameplay
      /autoPlay\s*\(/gi,
      /botDecision/gi,
      /automatedMove/gi,
      /aiAssist(?!.*disabled)/gi,

      // Server manipulation
      /bypassServer/gi,
      /fakeServerResponse/gi,
      /interceptNetwork/gi,
      /modifyPacket/gi,

      // Memory manipulation
      /readProcessMemory/gi,
      /writeProcessMemory/gi,
      /injectCode/gi,
    ];

    it('should not contain game state manipulation code', () => {
      for (const file of sourceFiles) {
        try {
          const content = readFileSync(file, 'utf-8');
          const violations = findForbiddenPatterns(content, forbiddenPatterns);

          assert.strictEqual(
            violations.length,
            0,
            `Forbidden pattern found in ${file}:\n` +
            violations.map(v =>
              `  Line ${v.line}: "${v.match}" (pattern: ${v.pattern})`
            ).join('\n')
          );
        } catch (error) {
          // Skip files that can't be read
          if (error.code !== 'ENOENT') {
            throw error;
          }
        }
      }
    });

    it('should not modify upstream game logic', () => {
      // Verify that we don't patch upstream files
      const srcFiles = sourceFiles.filter(f =>
        f.includes('src') && !f.includes('upstream')
      );

      for (const file of srcFiles) {
        try {
          const content = readFileSync(file, 'utf-8');

          // Check for monkey-patching of game objects
          const patchPatterns = [
            /Pokemon\.prototype\./gi,
            /Simulation\.prototype\./gi,
            /GameState\.prototype\./gi,
            /Player\.prototype\./gi,
          ];

          for (const pattern of patchPatterns) {
            const match = content.match(pattern);
            assert.strictEqual(
              match,
              null,
              `Potential game logic modification in ${file}: ${match?.[0]}`
            );
          }
        } catch (error) {
          if (error.code !== 'ENOENT') {
            throw error;
          }
        }
      }
    });
  });

  describe('Performance-Only Modifications', () => {
    it('should only modify rendering and display code', () => {
      const performanceFiles = sourceFiles.filter(f =>
        f.includes('performance') || f.includes('render')
      );

      // These files should NOT contain game logic terms
      const gameLogicTerms = [
        /calculateDamage/gi,
        /applyEffect/gi,
        /processAbility/gi,
        /updateGameState/gi,
        /simulateBattle/gi,
      ];

      for (const file of performanceFiles) {
        try {
          const content = readFileSync(file, 'utf-8');

          for (const term of gameLogicTerms) {
            const match = content.match(term);
            assert.strictEqual(
              match,
              null,
              `Game logic term found in performance file ${file}: ${match?.[0]}`
            );
          }
        } catch (error) {
          if (error.code !== 'ENOENT') {
            throw error;
          }
        }
      }
    });
  });

  describe('No Hidden Information Access', () => {
    it('should not access opponent deck or hand', () => {
      for (const file of sourceFiles) {
        try {
          const content = readFileSync(file, 'utf-8');

          const hiddenInfoPatterns = [
            /opponent.*deck/gi,
            /enemy.*cards/gi,
            /hidden.*pokemon/gi,
            /reveal.*opponent/gi,
            /peek.*hand/gi,
          ];

          const violations = findForbiddenPatterns(content, hiddenInfoPatterns);
          assert.strictEqual(
            violations.length,
            0,
            `Hidden information access in ${file}:\n` +
            violations.map(v => `  Line ${v.line}: "${v.match}"`).join('\n')
          );
        } catch (error) {
          if (error.code !== 'ENOENT') {
            throw error;
          }
        }
      }
    });
  });

  describe('No Network Manipulation', () => {
    // Files that legitimately intercept fetch for caching (not game traffic)
    // asset-cache.js only caches static assets (images, audio, fonts) and
    // explicitly excludes API calls, Firebase, Colyseus game server traffic
    const allowedCacheFiles = ['asset-cache.js'];

    it('should not intercept or modify network traffic', () => {
      for (const file of sourceFiles) {
        // Skip legitimate caching files
        if (allowedCacheFiles.some(allowed => file.endsWith(allowed))) {
          continue;
        }

        try {
          const content = readFileSync(file, 'utf-8');

          const networkPatterns = [
            /XMLHttpRequest\.prototype/gi,
            /fetch\s*=\s*/gi,
            /WebSocket\.prototype/gi,
            /interceptRequest/gi,
            /modifyResponse/gi,
          ];

          const violations = findForbiddenPatterns(content, networkPatterns);
          assert.strictEqual(
            violations.length,
            0,
            `Network manipulation in ${file}:\n` +
            violations.map(v => `  Line ${v.line}: "${v.match}"`).join('\n')
          );
        } catch (error) {
          if (error.code !== 'ENOENT') {
            throw error;
          }
        }
      }
    });

    it('asset cache should only cache static resources', () => {
      // Verify asset-cache.js has proper safeguards
      const assetCacheFile = sourceFiles.find(f => f.endsWith('asset-cache.js'));
      if (!assetCacheFile) return;

      const content = readFileSync(assetCacheFile, 'utf-8');

      // Must have NEVER_CACHE_PATTERNS that exclude game traffic
      assert.ok(
        content.includes('NEVER_CACHE_PATTERNS'),
        'asset-cache.js must define NEVER_CACHE_PATTERNS'
      );

      // Must exclude API, Firebase, Colyseus, WebSocket traffic
      const requiredExclusions = ['api', 'firebase', 'colyseus', 'socket'];
      for (const exclusion of requiredExclusions) {
        assert.ok(
          content.toLowerCase().includes(exclusion),
          `asset-cache.js must exclude ${exclusion} traffic`
        );
      }

      // Must NOT modify response content
      assert.ok(
        !content.includes('modifyResponse') && !content.includes('alterResponse'),
        'asset-cache.js must not modify response content'
      );
    });
  });

  describe('Documentation Compliance', () => {
    it('should have ethical compliance documentation', () => {
      const docsDir = join(ROOT, 'docs');
      try {
        const files = readdirSync(docsDir);
        const hasEthicsDoc = files.some(f =>
          f.toLowerCase().includes('ethics') ||
          f.toLowerCase().includes('compliance') ||
          f.toLowerCase().includes('fair')
        );

        // This is a soft check - we'll add documentation
        if (!hasEthicsDoc) {
          console.log('Note: Consider adding ethics documentation');
        }
      } catch {
        // docs directory doesn't exist yet
      }
    });
  });
});

describe('Build Safety', () => {
  it('should not bundle development tools in production', () => {
    // Verify that debug/dev tools are properly gated
    const srcFiles = getSourceFiles(join(ROOT, 'src'));

    for (const file of srcFiles) {
      try {
        const content = readFileSync(file, 'utf-8');

        // Check for proper debug guards
        if (content.includes('devtools') || content.includes('debugger')) {
          const hasGuard =
            content.includes('process.env.NODE_ENV') ||
            content.includes('cfg!(debug_assertions)') ||
            content.includes('if (debug)') ||
            content.includes('// DEBUG ONLY');

          if (!hasGuard) {
            console.log(`Warning: ${file} contains debug code without guards`);
          }
        }
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw error;
        }
      }
    }
  });
});
