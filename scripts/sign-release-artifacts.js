#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertExistingFile, getWindowsReleaseArtifacts } from './release-artifacts.js';

function fail(message) {
  console.error(`[release:sign] ${message}`);
  process.exit(1);
}

function getSigningConfig() {
  const privateKey = process.env.TAURI_PRIVATE_KEY || process.env.TAURI_SIGNING_PRIVATE_KEY;
  const privateKeyPath = process.env.TAURI_PRIVATE_KEY_PATH || process.env.TAURI_SIGNING_PRIVATE_KEY_PATH;
  const password =
    process.env.TAURI_PRIVATE_KEY_PASSWORD ||
    process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD;

  if (!privateKey && !privateKeyPath) {
    fail(
      'Missing signing key. Set TAURI_PRIVATE_KEY or TAURI_PRIVATE_KEY_PATH ' +
      '(legacy TAURI_SIGNING_PRIVATE_KEY[_PATH] is also accepted).'
    );
  }

  if (!password) {
    fail(
      'Missing TAURI_PRIVATE_KEY_PASSWORD. Refusing to invoke the Tauri signer ' +
      'because it may wait for interactive password input.'
    );
  }

  return { privateKey, privateKeyPath, password };
}

function prepareSigningConfig(config) {
  if (config.privateKeyPath) {
    return {
      privateKeyPath: config.privateKeyPath,
      password: config.password,
      cleanup: () => {},
    };
  }

  const tempDir = mkdtempSync(join(tmpdir(), 'pac-deluxe-tauri-key-'));
  const privateKeyPath = join(tempDir, 'private.key');
  writeFileSync(privateKeyPath, config.privateKey, 'utf-8');
  return {
    privateKeyPath,
    password: config.password,
    cleanup: () => rmSync(tempDir, { recursive: true, force: true }),
  };
}

function extractSignature(stdout, artifactPath) {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const candidates = [];
  for (const line of lines) {
    const colonIndex = line.lastIndexOf(':');
    if (colonIndex >= 0) {
      candidates.push(line.slice(colonIndex + 1).trim());
    }
    candidates.push(line);
  }

  const signature = candidates
    .reverse()
    .find((candidate) => /^[A-Za-z0-9+/=._-]{40,}$/.test(candidate));

  if (!signature) {
    throw new Error(`Could not parse Tauri signer output for ${artifactPath}`);
  }

  return signature;
}

function runSigner(artifactPath, config) {
  const npxBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const args = [
    'tauri',
    'signer',
    'sign',
    '-f',
    config.privateKeyPath,
    '-p',
    config.password,
    artifactPath,
  ];

  const env = {
    ...process.env,
    TAURI_PRIVATE_KEY_PASSWORD: config.password,
  };
  delete env.TAURI_PRIVATE_KEY;
  delete env.TAURI_SIGNING_PRIVATE_KEY;

  const result = spawnSync(npxBin, args, {
    cwd: process.cwd(),
    encoding: 'utf-8',
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      `Tauri signer failed for ${artifactPath}.\n${result.stderr || result.stdout}`
    );
  }

  return extractSignature(result.stdout, artifactPath);
}

const config = prepareSigningConfig(getSigningConfig());
try {
  const artifacts = getWindowsReleaseArtifacts();

  for (const artifact of artifacts) {
    assertExistingFile(artifact.path, `${artifact.kind} installer`);
    const signature = runSigner(artifact.path, config);
    const signaturePath = `${artifact.path}.sig`;
    writeFileSync(signaturePath, signature, 'ascii');
    console.log(`[release:sign] Wrote ${signaturePath}`);
  }
} finally {
  config.cleanup();
}
