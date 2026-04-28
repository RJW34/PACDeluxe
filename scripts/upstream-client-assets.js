#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const REQUIRED_UPSTREAM_CLIENT_GENERATED_PATHS = Object.freeze([
  'app/public/dist/client/locales/index.ts',
  'app/public/dist/client/locales/en/translation.json',
  'app/public/dist/client/changelog/patch-6.9.md',
  'app/public/dist/client/pokechess/index.html',
  'app/public/dist/client/sw.js',
]);

export const REQUIRED_TEXTURE_PACKS = Object.freeze([
  'abilities',
  'attacks',
  'item',
  'status',
  'types',
]);

const RESTORE_PATHS = Object.freeze([
  'app/public/dist/client/locales',
  'app/public/dist/client/changelog',
  'app/public/dist/client/pokechess',
  'app/public/dist/client/sw.js',
]);

function getUpstreamVersion(upstreamDir) {
  try {
    const pkg = JSON.parse(readFileSync(join(upstreamDir, 'package.json'), 'utf-8'));
    return typeof pkg.version === 'string' ? pkg.version : null;
  } catch {
    return null;
  }
}

export function getRequiredUpstreamClientGeneratedPaths(upstreamDir) {
  const version = getUpstreamVersion(upstreamDir);
  if (!version) {
    return [...REQUIRED_UPSTREAM_CLIENT_GENERATED_PATHS];
  }

  const texturePackPaths = REQUIRED_TEXTURE_PACKS.flatMap((pack) => [
    `app/public/dist/client/assets/${pack}/${pack}-${version}.json`,
    `app/public/dist/client/assets/${pack}/${pack}-${version}.png`,
  ]);

  return [
    ...REQUIRED_UPSTREAM_CLIENT_GENERATED_PATHS,
    ...texturePackPaths,
  ];
}

export function getMissingUpstreamClientGeneratedPaths(upstreamDir) {
  return getRequiredUpstreamClientGeneratedPaths(upstreamDir).filter(
    (relativePath) => !existsSync(join(upstreamDir, relativePath))
  );
}

function restoreGeneratedAssetsFromGit(upstreamDir) {
  if (!existsSync(join(upstreamDir, '.git'))) {
    return false;
  }

  execSync(`git restore -- ${RESTORE_PATHS.join(' ')}`, {
    cwd: upstreamDir,
    stdio: 'inherit',
  });
  return true;
}

function runAssetpack(upstreamDir) {
  execSync('npm run assetpack', {
    cwd: upstreamDir,
    stdio: 'inherit',
  });
}

export function ensureUpstreamClientGeneratedAssets({
  upstreamDir,
  log = () => {},
} = {}) {
  if (!upstreamDir) {
    throw new Error('ensureUpstreamClientGeneratedAssets requires upstreamDir');
  }

  const missing = getMissingUpstreamClientGeneratedPaths(upstreamDir);
  if (missing.length === 0) {
    return;
  }

  log(
    `Generated upstream client assets are missing (${missing.join(', ')}); attempting restore`
  );

  try {
    if (restoreGeneratedAssetsFromGit(upstreamDir)) {
      const stillMissing = getMissingUpstreamClientGeneratedPaths(upstreamDir);
      if (stillMissing.length === 0) {
      log('Restored generated upstream client assets from upstream git checkout');
      return;
    }

      const generatedAssetMissing = stillMissing.some((relativePath) =>
        relativePath.startsWith('app/public/dist/client/assets/')
      );

      if (!generatedAssetMissing) {
        throw new Error(`Still missing after git restore: ${stillMissing.join(', ')}`);
      }
    }
  } catch (error) {
    log(`Generated upstream asset restore did not complete: ${error.message}`);
  }

  const afterRestore = getMissingUpstreamClientGeneratedPaths(upstreamDir);
  if (
    afterRestore.some((relativePath) =>
      relativePath.startsWith('app/public/dist/client/assets/')
    )
  ) {
    log('Generated texture-pack atlases are missing; running upstream assetpack');
    try {
      runAssetpack(upstreamDir);
    } catch (error) {
      throw new Error(
        `Missing upstream generated texture-pack assets and assetpack failed: ${error.message}\n` +
          'Run npm run sync-upstream to reset the upstream checkout, then rerun the build.'
      );
    }
  }

  const stillMissing = getMissingUpstreamClientGeneratedPaths(upstreamDir);
  if (stillMissing.length === 0) {
    return;
  }

  throw new Error(
    `Missing upstream generated client assets: ${stillMissing.join(', ')}.\n` +
      'Run npm run sync-upstream to reset the upstream checkout, then rerun the build.'
  );
}
