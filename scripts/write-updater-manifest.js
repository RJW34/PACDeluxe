#!/usr/bin/env node
import { basename } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  assertExistingFile,
  getUpdaterManifestPath,
  getWindowsReleaseArtifacts,
  ROOT,
} from './release-artifacts.js';

function readPackageVersion() {
  return JSON.parse(readFileSync(`${ROOT}/package.json`, 'utf-8')).version;
}

function readSignature(path) {
  const signaturePath = `${path}.sig`;
  assertExistingFile(signaturePath, `signature for ${basename(path)}`);
  return readFileSync(signaturePath, 'utf-8').trim();
}

function resolveReleaseContext() {
  const version = readPackageVersion();
  const tag = process.env.GITHUB_REF_NAME || `v${version}`;
  const repository = process.env.GITHUB_REPOSITORY || 'RJW34/PACDeluxe';
  const releaseBaseUrl = `https://github.com/${repository}/releases/download/${tag}`;

  return { version, tag, releaseBaseUrl };
}

const { version, releaseBaseUrl } = resolveReleaseContext();
const artifacts = getWindowsReleaseArtifacts();
const byKind = Object.fromEntries(artifacts.map((artifact) => [artifact.kind, artifact]));

for (const artifact of artifacts) {
  assertExistingFile(artifact.path, `${artifact.kind} installer`);
}

const msi = byKind.msi;
const nsis = byKind.nsis;

const manifest = {
  version,
  notes: 'See the assets below to download and install this version.',
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': {
      signature: readSignature(msi.path),
      url: `${releaseBaseUrl}/${basename(msi.path)}`,
    },
    'windows-x86_64-msi': {
      signature: readSignature(msi.path),
      url: `${releaseBaseUrl}/${basename(msi.path)}`,
    },
    'windows-x86_64-nsis': {
      signature: readSignature(nsis.path),
      url: `${releaseBaseUrl}/${basename(nsis.path)}`,
    },
  },
};

const manifestPath = getUpdaterManifestPath();
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
console.log(`[release:manifest] Wrote ${manifestPath}`);
