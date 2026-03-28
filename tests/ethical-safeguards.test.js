/**
 * Ethical Safeguards Tests
 *
 * These tests scan PACDeluxe-owned source files for forbidden patterns that
 * would indicate cheating functionality.
 *
 * Scan scope: src/ (when present), scripts/, src-tauri/src/ (and subdirectories)
 * Excluded: docs/, tests/, dist/, upstream-game/, node_modules/, target/, validation/
 *
 * CRITICAL: All tests MUST pass before any release.
 * Failure indicates potential cheating functionality that must be removed.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { verifyBuildManifest } from '../scripts/verify-build-manifest.js';

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
      // Excluded: third-party (node_modules), upstream source (upstream-game), build output (dist, target),
      // documentation (docs), test code (tests), validation artifacts, git internals
      const skipDirs = ['node_modules', 'upstream-game', '.git', 'tests', 'target', 'dist', 'docs', 'validation'];
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
      const exemptPatternDefinitionFiles = ['ethical-safeguards.test.js', 'validate-determinism.js'];

      for (const file of sourceFiles) {
        try {
          const fileName = file.split(/[/\\]/).pop();
          if (exemptPatternDefinitionFiles.includes(fileName)) {
            continue;
          }

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
    it('should not intercept or modify network traffic', () => {
      // main.rs contains the PACDeluxe runtime, including an allowlisted proxy
      // wrapper for official upstream HTTP requests.
      const allowedFetchIntercept = ['main.rs'];

      for (const file of sourceFiles) {
        try {
          const content = readFileSync(file, 'utf-8');
          const fileName = file.split(/[/\\]/).pop();

          // The injected runtime in main.rs is allowed to wrap fetch for
          // allowlisted PACDeluxe runtime behavior.
          const networkPatterns = allowedFetchIntercept.includes(fileName)
            ? [
                /XMLHttpRequest\.prototype/gi,
                /WebSocket\.prototype/gi,
                /interceptRequest/gi,
                /modifyResponse/gi,
              ]
            : [
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

describe('Packaging Validation', () => {
  const distDir = join(ROOT, 'dist');
  const distExists = existsSync(distDir);

  it('should include required runtime directories in dist/ when built', () => {
    if (!distExists) {
      console.log('Note: dist/ not found, skipping packaging check (run npm run build:frontend first)');
      return;
    }

    // Check core files that must always exist
    const requiredFiles = ['index.html', 'index.js', 'index.css'];
    for (const file of requiredFiles) {
      const fullPath = join(distDir, file);
      assert.ok(
        existsSync(fullPath),
        `Required file missing from dist/: ${file}`
      );
    }

    // Check runtime directories that must exist for the app to function
    const requiredDirs = ['assets', 'locales'];
    const optionalDirs = ['style', 'pokechess', 'changelog'];

    for (const dir of requiredDirs) {
      assert.ok(
        existsSync(join(distDir, dir)),
        `Required directory missing from dist/: ${dir}/ — run npm run build:frontend`
      );
    }

    for (const dir of optionalDirs) {
      if (!existsSync(join(distDir, dir))) {
        console.log(`Note: optional dist/${dir}/ not found`);
      }
    }
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

describe('Architecture Guardrails', () => {
  it('should keep the patch manifest and docs in sync', () => {
    const result = verifyBuildManifest();
    assert.strictEqual(
      result.ok,
      true,
      `Build manifest verification failed:\n${result.errors.map((error) => `  - ${error}`).join('\n')}`
    );
  });

  it('should not rely on disable-web-security in the runtime', () => {
    const mainRs = readFileSync(join(ROOT, 'src-tauri', 'src', 'main.rs'), 'utf-8');
    assert.strictEqual(
      mainRs.includes('--disable-web-security'),
      false,
      'The runtime should not depend on the WebView browser-security bypass flag'
    );
  });

  it('should not scrape Firebase config from the live production site at build time', () => {
    const buildScript = readFileSync(join(ROOT, 'scripts', 'build-frontend.js'), 'utf-8');
    assert.strictEqual(
      buildScript.includes('Fetching Firebase config from live site'),
      false,
      'Builds must use explicit Firebase config instead of scraping production'
    );
    assert.strictEqual(
      buildScript.includes('https://pokemon-auto-chess.com/${scriptMatch[1]}'),
      false,
      'Builds must not parse the production bundle for config'
    );
  });
});
