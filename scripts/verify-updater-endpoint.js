#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './release-artifacts.js';

function getArgValue(name, fallback) {
  const prefix = `${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getExpectedVersion() {
  return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')).version;
}

function getUpdaterEndpoint() {
  const config = JSON.parse(
    readFileSync(join(ROOT, 'src-tauri', 'tauri.conf.json'), 'utf-8')
  );
  const endpoints = config.plugins?.updater?.endpoints ?? [];
  if (endpoints.length === 0) {
    throw new Error('No updater endpoints configured in src-tauri/tauri.conf.json');
  }
  return endpoints[0];
}

async function fetchUpdaterJson(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'PACDeluxe-release-verifier',
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Updater endpoint returned HTTP ${response.status}`);
  }

  return response.json();
}

const expectedVersion = process.env.EXPECTED_VERSION || getExpectedVersion();
const endpoint = process.env.UPDATER_ENDPOINT || getUpdaterEndpoint();
const retries = Number.parseInt(getArgValue('--retries', '1'), 10);
const delayMs = Number.parseInt(getArgValue('--delay-ms', '15000'), 10);

let lastError = null;

for (let attempt = 1; attempt <= retries; attempt += 1) {
  try {
    const latest = await fetchUpdaterJson(endpoint);
    const actualVersion = latest.version;

    if (actualVersion === expectedVersion) {
      console.log(
        `[verify:updater] OK - ${endpoint} advertises version ${actualVersion}`
      );
      process.exit(0);
    }

    lastError = new Error(
      `Updater endpoint advertises ${actualVersion || '<missing>'}, expected ${expectedVersion}`
    );
  } catch (error) {
    lastError = error;
  }

  if (attempt < retries) {
    console.log(
      `[verify:updater] Attempt ${attempt}/${retries} failed: ${lastError.message}; retrying...`
    );
    await sleep(delayMs);
  }
}

console.error(`[verify:updater] ${lastError.message}`);
console.error(`[verify:updater] Endpoint: ${endpoint}`);
process.exit(1);
