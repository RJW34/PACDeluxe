#!/usr/bin/env node
/**
 * Determinism Validation Harness
 *
 * Validates PACDeluxe source code for forbidden patterns and optionally
 * compares replay artifacts when they are present.
 */

import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { verifyBuildManifest } from './verify-build-manifest.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');
const VALIDATION_DIR = join(ROOT, 'validation');
const REPLAYS_DIR = join(VALIDATION_DIR, 'replays');
const REPORTS_DIR = join(VALIDATION_DIR, 'reports');

[VALIDATION_DIR, REPLAYS_DIR, REPORTS_DIR].forEach((dir) => {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
});

class DeterminismValidator {
  constructor() {
    this.errors = [];
    this.warnings = [];
    this.metrics = {
      ticksCompared: 0,
      statesMatched: 0,
      statesDiverged: 0,
      rngCallsVerified: 0,
    };
  }

  hashState(state) {
    const normalized = JSON.stringify(state, Object.keys(state).sort());
    return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
  }

  compareStates(nativeState, browserState) {
    this.metrics.ticksCompared++;

    if (nativeState.tick !== browserState.tick) {
      this.errors.push(`Tick mismatch: native=${nativeState.tick}, browser=${browserState.tick}`);
      return false;
    }

    const nativeHash = this.hashState(nativeState);
    const browserHash = this.hashState(browserState);

    if (nativeHash !== browserHash) {
      this.metrics.statesDiverged++;
      this.errors.push(
        `State divergence at tick ${nativeState.tick}: native=${nativeHash}, browser=${browserHash}`
      );
      return false;
    }

    this.metrics.statesMatched++;
    return true;
  }

  verifyRngSequence(nativeRng, browserRng) {
    if (nativeRng.length !== browserRng.length) {
      this.errors.push(
        `RNG call count mismatch: native=${nativeRng.length}, browser=${browserRng.length}`
      );
      return false;
    }

    for (let i = 0; i < nativeRng.length; i++) {
      if (nativeRng[i] !== browserRng[i]) {
        this.errors.push(
          `RNG divergence at call ${i}: native=${nativeRng[i]}, browser=${browserRng[i]}`
        );
        return false;
      }
      this.metrics.rngCallsVerified++;
    }

    return true;
  }

  loadReplay(path) {
    try {
      return JSON.parse(readFileSync(path, 'utf-8'));
    } catch {
      this.errors.push(`Failed to load replay: ${path}`);
      return null;
    }
  }

  compareReplays(nativePath, browserPath) {
    const nativeReplay = this.loadReplay(nativePath);
    const browserReplay = this.loadReplay(browserPath);

    if (!nativeReplay || !browserReplay) {
      return this.getResult();
    }

    const maxTicks = Math.max(
      nativeReplay.states?.length || 0,
      browserReplay.states?.length || 0
    );

    for (let i = 0; i < maxTicks; i++) {
      const nativeState = nativeReplay.states?.[i];
      const browserState = browserReplay.states?.[i];

      if (!nativeState || !browserState) {
        this.errors.push(`Missing state at tick ${i}`);
        continue;
      }

      this.compareStates(nativeState, browserState);
    }

    if (nativeReplay.rngCalls && browserReplay.rngCalls) {
      this.verifyRngSequence(nativeReplay.rngCalls, browserReplay.rngCalls);
    }

    if (nativeReplay.outcome && browserReplay.outcome) {
      if (JSON.stringify(nativeReplay.outcome) !== JSON.stringify(browserReplay.outcome)) {
        this.errors.push('Final game outcome diverged');
      }
    }

    return this.getResult();
  }

  getResult() {
    return {
      passed: this.errors.length === 0,
      errors: this.errors,
      warnings: this.warnings,
      metrics: this.metrics,
    };
  }

  generateReport(result) {
    const timestamp = new Date().toISOString();
    const status = result.passed ? 'PASSED' : 'FAILED';

    let report = `
================================================================================
DETERMINISM VALIDATION REPORT
================================================================================
Timestamp: ${timestamp}
Status: ${status}

METRICS:
  Ticks Compared:     ${result.metrics.ticksCompared}
  States Matched:     ${result.metrics.statesMatched}
  States Diverged:    ${result.metrics.statesDiverged}
  RNG Calls Verified: ${result.metrics.rngCallsVerified}

`;

    if (result.errors.length > 0) {
      report += `ERRORS (${result.errors.length}):\n`;
      result.errors.forEach((error, index) => {
        report += `  ${index + 1}. ${error}\n`;
      });
      report += '\n';
    }

    if (result.warnings.length > 0) {
      report += `WARNINGS (${result.warnings.length}):\n`;
      result.warnings.forEach((warning, index) => {
        report += `  ${index + 1}. ${warning}\n`;
      });
      report += '\n';
    }

    report += `
================================================================================
${result.passed ? 'VALIDATION PASSED - Safe to deploy' : 'VALIDATION FAILED - DO NOT DEPLOY'}
================================================================================
`;

    return report;
  }
}

class EthicalComplianceChecker {
  constructor() {
    this.violations = [];
    this.scannedFiles = 0;
  }

  getSourceFiles(dir, extensions = ['.js', '.ts', '.rs']) {
    const files = [];

    try {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        if (['node_modules', 'upstream-game', '.git', 'tests', 'target', 'dist'].includes(entry)) {
          continue;
        }

        const fullPath = join(dir, entry);
        try {
          const stat = statSync(fullPath);
          if (stat.isDirectory()) {
            files.push(...this.getSourceFiles(fullPath, extensions));
          } else if (extensions.some((ext) => entry.endsWith(ext))) {
            files.push(fullPath);
          }
        } catch {
          // Skip files we cannot inspect.
        }
      }
    } catch {
      // Directory does not exist.
    }

    return files;
  }

  scanDirectory(directory) {
    const exemptPatternDefinitionFiles = new Set(['validate-determinism.js']);
    const forbiddenPatterns = [
      { pattern: /opponent\.private/gi, desc: 'accessing opponent private data' },
      { pattern: /enemy\.hidden/gi, desc: 'accessing hidden enemy data' },
      { pattern: /Math\.random\s*=\s*/gi, desc: 'overriding Math.random' },
      { pattern: /Date\.now\s*=\s*/gi, desc: 'overriding Date.now' },
      { pattern: /performance\.now\s*=\s*/gi, desc: 'overriding performance.now' },
      { pattern: /XMLHttpRequest\.prototype\s*=/gi, desc: 'patching XMLHttpRequest' },
      { pattern: /WebSocket\.prototype\s*=/gi, desc: 'patching WebSocket' },
      { pattern: /autoPlay\s*\(/gi, desc: 'automated gameplay' },
      { pattern: /readProcessMemory/gi, desc: 'memory reading' },
      { pattern: /writeProcessMemory/gi, desc: 'memory writing' },
    ];

    console.log(`[EthicalChecker] Scanning ${directory}...`);

    const files = this.getSourceFiles(directory);
    this.scannedFiles += files.length;

    for (const file of files) {
      try {
        const fileName = file.split(/[/\\]/).pop();
        if (exemptPatternDefinitionFiles.has(fileName)) {
          continue;
        }

        const content = readFileSync(file, 'utf-8');
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          for (const { pattern, desc } of forbiddenPatterns) {
            if (pattern.test(line)) {
              this.violations.push(`${file}:${i + 1} - ${desc}`);
            }
            pattern.lastIndex = 0;
          }
        }
      } catch {
        // Skip files we cannot read.
      }
    }

    console.log(`[EthicalChecker] Scanned ${this.scannedFiles} files`);
    return this.violations.length === 0;
  }

  getViolations() {
    return this.violations;
  }
}

async function main() {
  console.log('================================================================================');
  console.log('PACDeluxe - Determinism Validation');
  console.log('================================================================================\n');

  const validator = new DeterminismValidator();
  const ethicsChecker = new EthicalComplianceChecker();
  let replayComparisonSkipped = false;

  console.log('[1/4] Verifying build manifest and documentation...');
  const manifestResult = verifyBuildManifest();
  if (!manifestResult.ok) {
    console.error('BUILD MANIFEST VERIFICATION FAILED');
    manifestResult.errors.forEach((error) => console.error(`  - ${error}`));
    process.exit(1);
  }
  console.log('  ✓ Build manifest verification passed\n');

  console.log('[2/4] Checking ethical compliance...');
  let ethicsPass = true;
  if (existsSync(join(ROOT, 'src'))) {
    ethicsPass = ethicsChecker.scanDirectory(join(ROOT, 'src')) && ethicsPass;
  }
  ethicsPass = ethicsChecker.scanDirectory(join(ROOT, 'scripts')) && ethicsPass;
  if (!ethicsPass) {
    console.error('ETHICAL COMPLIANCE CHECK FAILED');
    ethicsChecker.getViolations().forEach((violation) => console.error(`  - ${violation}`));
    process.exit(1);
  }
  console.log('  ✓ Ethical compliance check passed\n');

  console.log('[3/4] Checking for validation replays...');
  const nativeReplay = join(REPLAYS_DIR, 'native-latest.json');
  const browserReplay = join(REPLAYS_DIR, 'browser-latest.json');

  if (!existsSync(nativeReplay) || !existsSync(browserReplay)) {
    console.log('  ! No replay files found for comparison');
    console.log('  Note: Replay comparison requires recording games in both clients');
    console.log('  Skipping replay comparison...\n');
    replayComparisonSkipped = true;
  } else {
    console.log('  Found replay files, comparing...');
    const result = validator.compareReplays(nativeReplay, browserReplay);
    const report = validator.generateReport(result);
    const reportPath = join(REPORTS_DIR, `validation-${Date.now()}.txt`);
    writeFileSync(reportPath, report);
    console.log(`  Report saved to: ${reportPath}\n`);

    if (!result.passed) {
      console.error(report);
      console.error('VALIDATION FAILED - DO NOT DEPLOY');
      process.exit(1);
    }
    console.log('  ✓ Replay comparison passed\n');
  }

  console.log('[4/4] Running final integrity checks...');
  const rustChecker = new EthicalComplianceChecker();
  const rustPass = rustChecker.scanDirectory(join(ROOT, 'src-tauri', 'src'));

  if (!rustPass) {
    console.error('RUST CODE INTEGRITY CHECK FAILED');
    rustChecker.getViolations().forEach((violation) => console.error(`  - ${violation}`));
    process.exit(1);
  }

  const totalFilesScanned = ethicsChecker.scannedFiles + rustChecker.scannedFiles;
  console.log(`  ✓ Scanned ${totalFilesScanned} source files`);
  console.log('  ✓ No gameplay modifications detected');
  console.log('  ✓ No hidden state access detected');
  console.log('  ✓ No RNG manipulation detected');
  console.log('  ✓ No automated decision-making detected\n');

  console.log('================================================================================');
  if (replayComparisonSkipped) {
    console.log('PARTIAL VALIDATION PASSED');
    console.log('  - Build manifest verification: PASSED');
    console.log('  - Source code scan: PASSED');
    console.log('  - Replay comparison: SKIPPED (no replay files)');
    console.log('');
    console.log('This client bundles the upstream game and uses a native origin-scoped upstream proxy.');
    console.log('No gameplay-affecting modifications were detected in the scanned code.');
    console.log('Replay comparison still needs fixtures before validation can be considered complete.');
  } else {
    console.log('FULL VALIDATION PASSED - Safe to deploy');
  }
  console.log('================================================================================');
}

main().catch((error) => {
  console.error('Validation error:', error);
  process.exit(1);
});
