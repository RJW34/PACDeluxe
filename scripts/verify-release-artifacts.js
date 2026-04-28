#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  assertExistingFile,
  getUpdaterManifestPath,
  getWindowsReleaseArtifacts,
  ROOT,
} from './release-artifacts.js';
import { REQUIRED_TEXTURE_PACKS } from './upstream-client-assets.js';

const requireSignatures = process.argv.includes('--require-signatures');
const MIN_INSTALLER_BYTES = 100 * 1024 * 1024;
const upstreamVersion = JSON.parse(
  readFileSync(join(ROOT, 'upstream-game', 'package.json'), 'utf-8')
).version;
const packageVersion = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')).version;

function fail(message) {
  console.error(`[verify:release] ${message}`);
  process.exitCode = 1;
}

function checkFile(path, label, minBytes = 1) {
  try {
    assertExistingFile(path, label);
    const size = statSync(path).size;
    if (size < minBytes) {
      fail(`${label} is unexpectedly small (${size} bytes): ${path}`);
    }
    return size;
  } catch (error) {
    fail(error.message);
    return 0;
  }
}

for (const artifact of getWindowsReleaseArtifacts()) {
  const size = checkFile(artifact.path, `${artifact.kind} installer`, MIN_INSTALLER_BYTES);
  if (size > 0) {
    console.log(`[verify:release] ${artifact.kind} installer OK (${size} bytes)`);
  }

  if (requireSignatures) {
    const signatureSize = checkFile(`${artifact.path}.sig`, `${artifact.kind} updater signature`, 40);
    if (signatureSize > 0) {
      console.log(`[verify:release] ${artifact.kind} signature OK (${signatureSize} bytes)`);
    }
  }
}

if (requireSignatures) {
  const manifestPath = getUpdaterManifestPath();
  checkFile(manifestPath, 'updater latest.json', 100);

  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    if (manifest.version !== packageVersion) {
      fail(`updater latest.json version is ${manifest.version}, expected ${packageVersion}`);
    }

    for (const platform of ['windows-x86_64', 'windows-x86_64-msi', 'windows-x86_64-nsis']) {
      const entry = manifest.platforms?.[platform];
      if (!entry?.url || !entry?.signature) {
        fail(`updater latest.json is missing url/signature for ${platform}`);
      }
    }
  }
}

for (const pack of REQUIRED_TEXTURE_PACKS) {
  checkFile(
    join(ROOT, 'dist', 'assets', pack, `${pack}-${upstreamVersion}.json`),
    `${pack} atlas JSON`
  );
  checkFile(
    join(ROOT, 'dist', 'assets', pack, `${pack}-${upstreamVersion}.png`),
    `${pack} atlas PNG`
  );
}

checkFile(join(ROOT, 'dist', 'tilemap', 'AmpPlains.json'), 'packaged AmpPlains tilemap');
checkFile(join(ROOT, 'dist', 'tilemap', 'DarkCrater.json'), 'packaged DarkCrater tilemap');

if (!existsSync(join(ROOT, 'dist', 'sw.js'))) {
  fail('dist/sw.js cleanup worker is missing');
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log('[verify:release] Release artifact checks passed');
