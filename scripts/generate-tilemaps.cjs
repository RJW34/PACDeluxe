#!/usr/bin/env node
const { mkdirSync, rmSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');

const upstreamDir = resolve(process.argv[2] || '');
const outputDir = resolve(process.argv[3] || '');

if (!upstreamDir || !outputDir) {
  console.error('Usage: node scripts/generate-tilemaps.cjs <upstreamDir> <outputDir>');
  process.exit(1);
}

require(require.resolve('ts-node/register/transpile-only', { paths: [upstreamDir] }));

const { DungeonPMDO } = require(join(upstreamDir, 'app', 'types', 'enum', 'Dungeon'));
const { initTilemap } = require(join(upstreamDir, 'app', 'core', 'design'));

const mapNames = Object.keys(DungeonPMDO)
  .filter((name) => /^[A-Za-z0-9_-]+$/.test(name))
  .sort();

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });

const RealDate = Date;
const realRandom = Math.random;
let deterministicSeed = 0;

class TilemapDate extends RealDate {
  constructor(...args) {
    if (args.length > 0) {
      super(...args);
    } else {
      super(1700000000000 + deterministicSeed);
    }
  }

  static now() {
    return 1700000000000 + deterministicSeed;
  }
}

try {
  global.Date = TilemapDate;

  for (const [index, mapName] of mapNames.entries()) {
    deterministicSeed = (index + 1) * 1009;
    Math.random = () => {
      const value = Math.sin(deterministicSeed) * 10000;
      return value - Math.floor(value);
    };

    const tilemap = initTilemap(mapName);
    writeFileSync(join(outputDir, `${mapName}.json`), JSON.stringify(tilemap));
  }
} finally {
  global.Date = RealDate;
  Math.random = realRandom;
}

console.log(`[generate-tilemaps] Wrote ${mapNames.length} tilemaps to ${outputDir}`);
