import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function readPackageVersion() {
  const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
  return packageJson.version;
}

export function getWindowsReleaseArtifacts() {
  const version = readPackageVersion();
  const bundleDir = join(ROOT, 'src-tauri', 'target', 'release', 'bundle');

  return [
    {
      kind: 'nsis',
      path: join(bundleDir, 'nsis', `PACDeluxe_${version}_x64-setup.exe`),
    },
    {
      kind: 'msi',
      path: join(bundleDir, 'msi', `PACDeluxe_${version}_x64_en-US.msi`),
    },
  ];
}

export function getUpdaterManifestPath() {
  return join(ROOT, 'src-tauri', 'target', 'release', 'bundle', 'latest.json');
}

export function assertExistingFile(path, label) {
  if (!existsSync(path)) {
    throw new Error(`${label} is missing: ${path}`);
  }
}
