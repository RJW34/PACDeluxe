#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILD_MANIFEST_DOC, UPSTREAM_PATCHES } from './build-manifest.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

const STALE_PATTERNS = [
  /three non-gameplay changes/i,
  /three idempotent patches/i,
  /\(resize fix, booster Equip, server URL\)/i,
];

const STALE_PATTERN_FILES = [
  'README.md',
  'TRANSPARENCY.md',
  'CLAUDE.md',
  'docs/README.md',
  'docs/ETHICS_AND_COMPLIANCE.md',
  'docs/CHATGPT_AGENT_BRIEFING.md',
  'scripts/validate-determinism.js',
];

export function verifyBuildManifest() {
  const errors = [];
  const patchDocPath = join(ROOT, BUILD_MANIFEST_DOC);

  if (!existsSync(patchDocPath)) {
    errors.push(`Missing canonical patch manifest doc: ${BUILD_MANIFEST_DOC}`);
  } else {
    const patchDoc = readFileSync(patchDocPath, 'utf-8');
    for (const patch of UPSTREAM_PATCHES) {
      if (!patchDoc.includes(patch.id)) {
        errors.push(`Patch manifest doc is missing patch id "${patch.id}"`);
      }
      if (!patchDoc.includes(patch.file)) {
        errors.push(`Patch manifest doc is missing patch file "${patch.file}"`);
      }
    }
  }

  for (const relativePath of STALE_PATTERN_FILES) {
    const filePath = join(ROOT, relativePath);
    if (!existsSync(filePath)) {
      errors.push(`Expected verification target is missing: ${relativePath}`);
      continue;
    }

    const content = readFileSync(filePath, 'utf-8');
    for (const pattern of STALE_PATTERNS) {
      if (pattern.test(content)) {
        errors.push(`Stale build-patch wording found in ${relativePath}: ${pattern}`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

function main() {
  const result = verifyBuildManifest();

  if (!result.ok) {
    console.error('[verify-build-manifest] FAILED');
    for (const error of result.errors) {
      console.error(`  - ${error}`);
    }
    process.exit(1);
  }

  console.log(
    `[verify-build-manifest] OK - canonical patch inventory contains ${UPSTREAM_PATCHES.length} upstream patches`
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
