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

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  readFileSync,
  readdirSync,
  statSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  LOCAL_STATIC_FETCH_PREFIXES,
  LOCAL_STATIC_FETCH_EXTENSIONS,
  PROD_HOST,
  isLocalStaticPath,
} from '../scripts/proxy-manifest.js';
import { verifyBuildManifest } from '../scripts/verify-build-manifest.js';
import {
  REQUIRED_UPSTREAM_CLIENT_GENERATED_PATHS,
  REQUIRED_TEXTURE_PACKS,
  ensureUpstreamClientGeneratedAssets,
  getMissingUpstreamClientGeneratedPaths,
  getRequiredUpstreamClientGeneratedPaths,
} from '../scripts/upstream-client-assets.js';

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

function getSourceFilesRecursive(dir, extensions) {
  const files = [];

  try {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        files.push(...getSourceFilesRecursive(fullPath, extensions));
      } else if (extensions.some((ext) => entry.endsWith(ext))) {
        files.push(fullPath);
      }
    }
  } catch {
    // Directory does not exist or cannot be read.
  }

  return files;
}

function getUpstreamRelativeFetchPaths() {
  const upstreamSrcDir = join(ROOT, 'upstream-game', 'app', 'public', 'src');
  if (!existsSync(upstreamSrcDir)) {
    return null;
  }

  const relativeFetchPaths = new Set();
  const fetchPathPattern = /fetch\(\s*([`'"])(\/[\s\S]*?)\1/g;
  const files = getSourceFilesRecursive(upstreamSrcDir, ['.js', '.ts', '.tsx']);

  for (const file of files) {
    const content = readFileSync(file, 'utf-8');
    for (const match of content.matchAll(fetchPathPattern)) {
      relativeFetchPaths.add(match[2]);
    }
  }

  return Array.from(relativeFetchPaths).sort();
}

function createTempUpstreamDir() {
  return mkdtempSync(join(tmpdir(), 'pac-upstream-assets-'));
}

function writeRequiredGeneratedUpstreamAssets(upstreamDir) {
  for (const relativePath of REQUIRED_UPSTREAM_CLIENT_GENERATED_PATHS) {
    const fullPath = join(upstreamDir, relativePath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, '{}\n');
  }
}

function readTauriMain() {
  return readFileSync(join(ROOT, 'src-tauri', 'src', 'main.rs'), 'utf-8');
}

function readRuntimeScript(name) {
  return readFileSync(join(ROOT, 'src-tauri', 'src', 'runtime', name), 'utf-8');
}

function readLocalhostServer() {
  return readFileSync(join(ROOT, 'src-tauri', 'src', 'localhost_server.rs'), 'utf-8');
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
      const allowedFetchIntercept = ['main.rs', 'overlay.js'];

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
    const requiredDirs = ['assets', 'locales', 'tilemap'];
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

    assert.ok(
      existsSync(join(distDir, 'tilemap', 'AmpPlains.json')),
      'Required packaged tilemap missing from dist/: tilemap/AmpPlains.json'
    );
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

  it('should declare the generated upstream client assets required by the build', () => {
    const requiredPaths = getRequiredUpstreamClientGeneratedPaths(join(ROOT, 'upstream-game'));

    assert.ok(
      REQUIRED_UPSTREAM_CLIENT_GENERATED_PATHS.includes(
        'app/public/dist/client/locales/index.ts'
      ),
      'The build must require the generated locales module imported by upstream source'
    );
    assert.ok(
      REQUIRED_UPSTREAM_CLIENT_GENERATED_PATHS.includes(
        'app/public/dist/client/locales/en/translation.json'
      ),
      'The build must require the English translation JSON used by upstream runtime imports'
    );
    assert.ok(
      REQUIRED_UPSTREAM_CLIENT_GENERATED_PATHS.includes(
        'app/public/dist/client/pokechess/index.html'
      ),
      'The build must require the generated pokechess runtime assets copied into PAC dist/'
    );
    assert.ok(
      REQUIRED_TEXTURE_PACKS.includes('abilities') &&
        REQUIRED_TEXTURE_PACKS.includes('item') &&
        REQUIRED_TEXTURE_PACKS.includes('types'),
      'The build must know about upstream texture-pack atlas families'
    );
    if (existsSync(join(ROOT, 'upstream-game', 'package.json'))) {
      assert.ok(
        requiredPaths.some((relativePath) =>
          /app\/public\/dist\/client\/assets\/abilities\/abilities-\d+\.\d+\.\d+\.json/.test(relativePath)
        ),
        'The build must require generated versioned Phaser texture-pack JSON atlases'
      );
      assert.ok(
        requiredPaths.some((relativePath) =>
          /app\/public\/dist\/client\/assets\/item\/item-\d+\.\d+\.\d+\.png/.test(relativePath)
        ),
        'The build must require generated versioned Phaser texture-pack PNG atlases'
      );
    }
  });

  it('should fail loudly when generated upstream client assets are missing outside a git checkout', () => {
    const upstreamDir = createTempUpstreamDir();
    try {
      assert.throws(
        () => ensureUpstreamClientGeneratedAssets({ upstreamDir }),
        /Missing upstream generated client assets/,
        'Missing upstream generated client assets must not fall through to an opaque esbuild failure'
      );
    } finally {
      rmSync(upstreamDir, { recursive: true, force: true });
    }
  });

  it('should pass the generated upstream client asset check when all required files exist', () => {
    const upstreamDir = createTempUpstreamDir();
    try {
      writeRequiredGeneratedUpstreamAssets(upstreamDir);
      assert.deepStrictEqual(getMissingUpstreamClientGeneratedPaths(upstreamDir), []);
      assert.doesNotThrow(() => ensureUpstreamClientGeneratedAssets({ upstreamDir }));
    } finally {
      rmSync(upstreamDir, { recursive: true, force: true });
    }
  });

  it('should not rely on disable-web-security in the runtime', () => {
    const runtimeSurface = [
      readTauriMain(),
      readRuntimeScript('overlay.js'),
      readRuntimeScript('auth-popup-bridge.js'),
    ].join('\n');
    assert.strictEqual(
      runtimeSurface.includes('--disable-web-security'),
      false,
      'The runtime should not depend on the WebView browser-security bypass flag'
    );
  });

  it('should keep injected runtime scripts in standalone JavaScript files', () => {
    const mainRs = readTauriMain();
    assert.ok(
      mainRs.includes('include_str!("runtime/overlay.js")'),
      'main.rs should include the overlay runtime from src-tauri/src/runtime/overlay.js'
    );
    assert.ok(
      mainRs.includes('include_str!("runtime/auth-popup-bridge.js")'),
      'main.rs should include the auth popup bridge from src-tauri/src/runtime/auth-popup-bridge.js'
    );
    assert.ok(
      readRuntimeScript('overlay.js').includes('Native proxy active'),
      'overlay.js should contain the PACDeluxe runtime proxy bootstrap'
    );
    assert.ok(
      readRuntimeScript('auth-popup-bridge.js').includes('window.opener mock installed'),
      'auth-popup-bridge.js should contain the Firebase popup opener mock'
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
      // biome-ignore lint/suspicious/noTemplateCurlyInString: This is the literal stale production-scrape marker.
      buildScript.includes('https://pokemon-auto-chess.com/${scriptMatch[1]}'),
      false,
      'Builds must not parse the production bundle for config'
    );
  });

  it('should pin the Rust proxy to the production origin only', () => {
    const commandsRs = readFileSync(join(ROOT, 'src-tauri', 'src', 'commands.rs'), 'utf-8');

    assert.ok(
      commandsRs.includes(`const PROD_HOST: &str = "${PROD_HOST}";`),
      'commands.rs must pin the production host constant to scripts/proxy-manifest.js'
    );
    // The old path-allowlist model should stay gone. If it reappears, the
    // Rust and JS sides will silently drift again.
    assert.ok(
      !commandsRs.includes('PROXY_API_PATHS'),
      'commands.rs must not reintroduce the path allowlist - use the origin-scoped model'
    );
    assert.ok(
      !commandsRs.includes('is_allowlisted_proxy_path'),
      'commands.rs must not reintroduce path-based allowlisting helpers'
    );
  });

  it('should pin the JS fetch interceptor to the shared local-asset manifest', () => {
    const overlayJs = readRuntimeScript('overlay.js');

    for (const prefix of LOCAL_STATIC_FETCH_PREFIXES) {
      assert.ok(
        overlayJs.includes(`'${prefix}'`),
        `overlay.js localAssetPrefixes is missing ${prefix}`
      );
    }
    for (const ext of LOCAL_STATIC_FETCH_EXTENSIONS) {
      assert.ok(
        overlayJs.includes(`'${ext}'`),
        `overlay.js localAssetExtensions is missing ${ext}`
      );
    }
    assert.ok(
      overlayJs.includes(`const PROD_HOST = '${PROD_HOST}';`),
      'overlay.js must pin PROD_HOST to scripts/proxy-manifest.js'
    );
    // The old runtime allowlist should stay gone.
    assert.ok(
      !overlayJs.includes('const apiPrefixes = ['),
      'overlay.js must not reintroduce the apiPrefixes allowlist - use the origin-scoped model'
    );
  });

  it('should cover every known upstream relative fetch as either a local asset or a proxied upstream call', () => {
    const relativeFetchPaths = getUpstreamRelativeFetchPaths();
    if (relativeFetchPaths === null) {
      console.log('Note: upstream-game not found, skipping proxy coverage check');
      return;
    }

    // Under the origin-scoped model every relative fetch is classifiable:
    // either the shared manifest marks it as a local static asset, or it
    // falls through to the proxy. There are no "unknown" paths anymore -
    // but we still require the known local-asset prefixes to actually map
    // to local assets in the manifest so a future change can't silently
    // start proxying translation JSON.
    const expectedLocalPrefixes = ['/locales/'];
    for (const prefix of expectedLocalPrefixes) {
      assert.ok(
        LOCAL_STATIC_FETCH_PREFIXES.includes(prefix),
        `Upstream fetches paths starting with ${prefix} - manifest must classify it as a local asset`
      );
    }

    // Every relative upstream fetch must classify cleanly (either local or
    // upstream API). The isLocalStaticPath helper is the canonical
    // classifier used by both the dev server and the injected runtime.
    for (const path of relativeFetchPaths) {
      const pathname = path.split('?')[0];
      const classifiedLocal = isLocalStaticPath(pathname);
      // If not local, it's an upstream API call. No further assertion
      // needed - the origin-scoped proxy will route it to production.
      if (!classifiedLocal) {
        // Sanity check: make sure we haven't accidentally classified a
        // translation JSON as upstream.
        assert.ok(
          !pathname.startsWith('/locales/'),
          `Upstream fetch ${pathname} should be a local asset but the classifier rejected it`
        );
      }
    }
  });

  it('should provide a local-static classifier that both runtimes and tools can rely on', () => {
    // Spot-check the shared classifier: well-known local assets stay local,
    // well-known API paths get proxied.
    assert.strictEqual(isLocalStaticPath('/assets/ui/favicon.ico'), true);
    assert.strictEqual(isLocalStaticPath('/locales/en/translation.json'), true);
    assert.strictEqual(isLocalStaticPath('/index.js'), true);
    assert.strictEqual(isLocalStaticPath('/style/index.css'), true);
    assert.strictEqual(isLocalStaticPath('/'), true);

    assert.strictEqual(isLocalStaticPath('/profile'), false);
    assert.strictEqual(isLocalStaticPath('/bots'), false);
    assert.strictEqual(isLocalStaticPath('/leaderboards'), false);
    assert.strictEqual(isLocalStaticPath('/tilemap/forest'), true);
    assert.strictEqual(isLocalStaticPath('/game-history/abc'), false);
    assert.strictEqual(isLocalStaticPath('/chat-history/abc'), false);
    assert.strictEqual(isLocalStaticPath('/moderation/rename-account'), false);
    assert.strictEqual(isLocalStaticPath('/some-future-endpoint'), false);

    // Queries and fragments must not flip classification.
    assert.strictEqual(isLocalStaticPath('/assets/foo.png?v=1'), true);
    assert.strictEqual(isLocalStaticPath('/index.js#abc'), true);
    assert.strictEqual(isLocalStaticPath('/profile?t=1'), false);
    assert.strictEqual(isLocalStaticPath('/bots#top'), false);
  });

  it('should URL-gate the main-window window.open mock so non-auth popups do not clobber activeMockPopup', () => {
    const overlayJs = readRuntimeScript('overlay.js');
    // The interceptor must check for an auth-looking URL before returning
    // a mock, otherwise Discord/Patreon _blank popups would replace the
    // Firebase auth popup reference mid-flow.
    assert.ok(
      overlayJs.includes('function isAuthPopupUrl(url)'),
      'OVERLAY_SCRIPT must gate its window.open mock via an auth-URL predicate'
    );
    assert.ok(
      overlayJs.includes("if (!isAuthPopupUrl(url))"),
      'window.open mock must return early for non-auth URLs'
    );
  });

  it('should bridge main->popup MessageEvents from Rust rather than a re-registered JS listener', () => {
    const mainRs = readTauriMain();
    const authBridgeJs = readRuntimeScript('auth-popup-bridge.js');
    // Rust-side dispatch avoids accumulating zombie listeners on the
    // Tauri event bus every time the popup navigates cross-origin during
    // OAuth (the JS initialization_script would otherwise re-register).
    assert.ok(
      mainRs.includes('app.listen_any("pac-main-to-popup"'),
      'setup() must register a Rust-side listener for pac-main-to-popup'
    );
    assert.ok(
      !authBridgeJs.includes("event.listen('pac-main-to-popup'"),
      'AUTH_POPUP_BRIDGE_SCRIPT must not re-register a JS listener for pac-main-to-popup on every popup page load'
    );
  });

  it('should keep FirebaseUI on popup auth so the main WebView stays on the bundled client', () => {
    const buildScript = readFileSync(join(ROOT, 'scripts', 'build-frontend.js'), 'utf-8');
    assert.ok(
      buildScript.includes('loginContent.includes(\'signInFlow: "redirect"\')'),
      'build-frontend.js must detect redirect auth as the stale upstream/local-build state'
    );
    assert.ok(
      buildScript.includes('\'signInFlow: "popup"\''),
      'build-frontend.js must patch FirebaseUI to popup auth for the Tauri popup bridge'
    );
    assert.strictEqual(
      buildScript.includes('Switch Firebase auth to redirect flow'),
      false,
      'build-frontend.js must not restore the old redirect-auth patch'
    );
  });

  it('should disable upstream persistent service-worker asset caching', () => {
    const buildScript = readFileSync(join(ROOT, 'scripts', 'build-frontend.js'), 'utf-8');

    assert.ok(
      buildScript.includes('service-worker-cache-disable'),
      'build-frontend.js must apply the service-worker-cache-disable patch'
    );
    assert.ok(
      buildScript.includes('registration.unregister()'),
      'the local build must unregister existing service workers'
    );
    assert.ok(
      buildScript.includes('window.caches.delete(key)'),
      'the local build must clear CacheStorage entries created by old upstream service workers'
    );
    assert.ok(
      buildScript.includes('createServiceWorkerCleanupScript'),
      'dist/sw.js must be replaced with a cleanup worker, not copied from upstream'
    );
    assert.strictEqual(
      buildScript.includes('cpSync(join(clientDist, \'sw.js\')'),
      false,
      'build-frontend.js must not copy the upstream cache-first sw.js into dist/'
    );
  });

  it('should copy upstream generated texture-pack atlases into PAC dist assets', () => {
    const buildScript = readFileSync(join(ROOT, 'scripts', 'build-frontend.js'), 'utf-8');

    assert.ok(
      buildScript.includes('generatedAssetsDir'),
      'build-frontend.js must locate app/public/dist/client/assets'
    );
    assert.ok(
      buildScript.includes('Copied generated texture-pack assets/'),
      'build-frontend.js must copy generated texture-pack assets into dist/assets'
    );
    assert.ok(
      buildScript.includes('Pokemon sprites remain stuck on loading_pokeball placeholders'),
      'the build script should document why generated atlases are required'
    );
  });

  it('should package generated tilemaps for render-critical Phaser preload', () => {
    const buildScript = readFileSync(join(ROOT, 'scripts', 'build-frontend.js'), 'utf-8');
    const generatorScript = readFileSync(join(ROOT, 'scripts', 'generate-tilemaps.cjs'), 'utf-8');
    const releaseVerifier = readFileSync(join(ROOT, 'scripts', 'verify-release-artifacts.js'), 'utf-8');

    assert.ok(
      LOCAL_STATIC_FETCH_PREFIXES.includes('/tilemap/'),
      'the local-static manifest must serve /tilemap/ from packaged files'
    );
    assert.ok(
      buildScript.includes('generateLocalTilemaps'),
      'build-frontend.js must generate packaged tilemap files'
    );
    assert.ok(
      buildScript.includes('before the Tauri fetch proxy has initialized'),
      'build-frontend.js should document why tilemaps cannot rely on the injected proxy'
    );
    assert.ok(
      generatorScript.includes('initTilemap(mapName)'),
      'tilemap generation must use the upstream initTilemap implementation'
    );
    assert.ok(
      releaseVerifier.includes("dist', 'tilemap', 'AmpPlains.json"),
      'release verification must require generated packaged tilemaps'
    );
  });

  it('should keep release signing noninteractive and verified in CI', () => {
    const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
    const releaseWorkflow = readFileSync(join(ROOT, '.github', 'workflows', 'release.yml'), 'utf-8');
    const signScript = readFileSync(join(ROOT, 'scripts', 'sign-release-artifacts.js'), 'utf-8');
    const verifyScript = readFileSync(join(ROOT, 'scripts', 'verify-release-artifacts.js'), 'utf-8');
    const updaterScript = readFileSync(join(ROOT, 'scripts', 'verify-updater-endpoint.js'), 'utf-8');
    const releaseChecklist = readFileSync(join(ROOT, 'docs', 'RELEASE_CHECKLIST.md'), 'utf-8');

    assert.strictEqual(
      packageJson.scripts['release:sign'],
      'node scripts/sign-release-artifacts.js',
      'package.json must expose release:sign'
    );
    assert.strictEqual(
      packageJson.scripts['release:manifest'],
      'node scripts/write-updater-manifest.js',
      'package.json must expose release:manifest'
    );
    assert.strictEqual(
      packageJson.scripts['verify:release'],
      'node scripts/verify-release-artifacts.js --require-signatures',
      'package.json must expose verify:release with signature enforcement'
    );
    assert.strictEqual(
      packageJson.scripts['verify:updater'],
      'node scripts/verify-updater-endpoint.js',
      'package.json must expose verify:updater'
    );
    assert.ok(
      releaseWorkflow.includes('TAURI_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}'),
      'release workflow must map existing key secret to the Tauri 2 private-key env var'
    );
    assert.ok(
      releaseWorkflow.includes('npm run release:sign') &&
        releaseWorkflow.includes('npm run release:manifest') &&
        releaseWorkflow.includes('npm run verify:release'),
      'release workflow must sign, write updater metadata, and verify artifacts before upload'
    );
    assert.ok(
      releaseWorkflow.includes('npm run verify:updater'),
      'release workflow must verify the published updater endpoint after upload'
    );
    assert.ok(
      releaseWorkflow.includes('gh release create') &&
        releaseWorkflow.includes('latest.json'),
      'release workflow must publish installers, signatures, and latest.json explicitly'
    );
    assert.ok(
      signScript.includes('Refusing to invoke the Tauri signer') &&
        signScript.includes('TAURI_PRIVATE_KEY_PASSWORD'),
      'release signing must fail clearly when the key password is missing'
    );
    assert.ok(
      signScript.includes('mkdtempSync') &&
        signScript.includes("'-f'") &&
        signScript.includes('delete env.TAURI_PRIVATE_KEY'),
      'release signing must pass private keys through a temporary key file, not raw Windows argv'
    );
    assert.ok(
      verifyScript.includes('--require-signatures') &&
        verifyScript.includes('updater signature') &&
        verifyScript.includes('updater latest.json'),
      'release verification must require updater signatures and latest.json'
    );
    assert.ok(
      updaterScript.includes('Updater endpoint advertises') &&
        updaterScript.includes('tauri.conf.json'),
      'updater verification must compare live latest.json against the package version'
    );
    assert.ok(
      releaseChecklist.includes('npm run release:sign') &&
        releaseChecklist.includes('npm run verify:release') &&
        releaseChecklist.includes('npm run verify:updater'),
      'release checklist must document signing, release verification, and updater verification'
    );
  });

  it('should not fall back to index.html for missing packaged assets or upstream API paths', () => {
    const localhostServer = readLocalhostServer();

    assert.ok(
      localhostServer.includes('is_spa_route_path(path)'),
      'localhost_server.rs must only use index.html fallback for known SPA routes'
    );
    assert.ok(
      localhostServer.includes('is_local_static_path(path)'),
      'localhost_server.rs must distinguish missing packaged assets from SPA routes'
    );
    assert.ok(
      localhostServer.includes('missing local asset'),
      'missing local assets should produce an explicit 404 path'
    );
    assert.ok(
      localhostServer.includes('native proxy required'),
      'same-origin API paths that escape the JS proxy should fail explicitly'
    );
    assert.strictEqual(
      localhostServer.includes('primary.or_else(|| resolver.get("/index.html".to_string()))'),
      false,
      'localhost_server.rs must not return index.html for every resolver miss'
    );
  });

  it('should keep the proxy redirect policy scoped to the production origin', () => {
    const commandsRs = readFileSync(join(ROOT, 'src-tauri', 'src', 'commands.rs'), 'utf-8');
    // If a redirect target is off-origin, reqwest could leak headers or
    // cookies the server scoped to its own origin. The custom policy
    // must reject non-prod hosts. The actual host/scheme rule is unit
    // tested in Rust via is_safe_proxy_redirect_target — here we guard
    // against a regression that drops the custom policy altogether.
    assert.ok(
      commandsRs.includes('reqwest::redirect::Policy::custom'),
      'proxy_http_request must use a custom redirect policy, not Policy::limited'
    );
    assert.ok(
      !commandsRs.includes('Policy::limited('),
      'proxy_http_request must not fall back to reqwest\'s built-in redirect policy'
    );
    assert.ok(
      commandsRs.includes('fn is_safe_proxy_redirect_target'),
      'proxy_http_request must delegate redirect validation to is_safe_proxy_redirect_target'
    );
  });
});
