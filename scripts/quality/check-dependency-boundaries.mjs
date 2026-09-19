#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const desktopRoot = join(repoRoot, 'apps', 'desktop');
const desktopPackage = readJson(join(desktopRoot, 'package.json'));
const desktopLock = readJson(join(desktopRoot, 'package-lock.json'));
const failures = [];

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function packageVersion(name) {
  return desktopLock.packages?.[`node_modules/${name}`]?.version;
}

function hasAdjacentLock(directory) {
  return ['package-lock.json', 'pnpm-lock.yaml'].some((name) => existsSync(join(directory, name)));
}

function verifyVendoredDesktopDependencies() {
  let vendored = 0;
  for (const [name, spec] of Object.entries(desktopPackage.dependencies ?? {})) {
    if (!spec.startsWith('file:')) continue;
    vendored += 1;
    const target = resolve(desktopRoot, spec.slice('file:'.length));
    if (!existsSync(target)) failures.push(`${name}: vendored target is missing (${spec})`);
    if (!packageVersion(name)) failures.push(`${name}: desktop lockfile has no package entry`);
  }
  return vendored;
}

function verifyFirstPartyPackages() {
  let packages = 0;
  let hostManaged = 0;
  let locked = 0;
  let runtimeEdges = 0;

  for (const parent of ['plugins', 'client-plugins']) {
    const parentPath = join(repoRoot, parent);
    for (const entry of readdirSync(parentPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      // This optional upstream checkout is ignored by Git and absent in CI.
      // The packaged sidebar tarball is already covered by the desktop lock.
      if (parent === 'plugins' && entry.name === 'dsh-better-sidebar') continue;
      const directory = join(parentPath, entry.name);
      const packagePath = join(directory, 'package.json');
      if (!existsSync(packagePath)) continue;
      packages += 1;
      const independentlyLocked = hasAdjacentLock(directory);
      if (independentlyLocked) locked += 1;
      else hostManaged += 1;

      const manifest = readJson(packagePath);
      if (independentlyLocked) continue;
      for (const [name, spec] of Object.entries(manifest.dependencies ?? {})) {
        runtimeEdges += 1;
        const actual = packageVersion(name);
        if (!actual) {
          failures.push(`${parent}/${entry.name}: ${name} is absent from apps/desktop/package-lock.json`);
          continue;
        }
        if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(spec)) {
          failures.push(`${parent}/${entry.name}: ${name} must use an exact version, found ${spec}`);
        } else if (actual !== spec) {
          failures.push(`${parent}/${entry.name}: ${name} declares ${spec}, desktop lock resolves ${actual}`);
        }
      }
    }
  }
  return { packages, hostManaged, locked, runtimeEdges };
}

function verifyDeepSeekClosure() {
  const entries = Object.entries(desktopLock.packages ?? {}).filter(([key]) =>
    key.startsWith('node_modules/@deepseek-ai/'),
  );
  const alpha = entries.filter(([, value]) => value.version === '0.1.3-alpha.1');
  if (entries.length === 0) failures.push('desktop lockfile contains no @deepseek-ai package entries');
  if (alpha.length === 0) failures.push('desktop lockfile contains no 0.1.3-alpha.1 package entries');
  return { entries: entries.length, alpha: alpha.length };
}

const vendored = verifyVendoredDesktopDependencies();
const firstParty = verifyFirstPartyPackages();
const deepSeek = verifyDeepSeekClosure();

if (failures.length > 0) {
  process.stderr.write(`[dependencies] FAIL (${failures.length})\n`);
  for (const failure of failures) process.stderr.write(`  - ${failure}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `[dependencies] PASS: ${firstParty.packages} first-party manifests (${firstParty.hostManaged} host-managed, ${firstParty.locked} independently locked), ${firstParty.runtimeEdges} runtime edges in the desktop lock, ${vendored} vendored desktop inputs present; @deepseek-ai entries ${deepSeek.entries}, alpha ${deepSeek.alpha}.\n`,
  );
}
