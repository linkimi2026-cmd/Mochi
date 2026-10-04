#!/usr/bin/env node
// Read-only inventory: never install packages or modify the running Mochi profile.
import { readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const candidate = process.argv[2];
const destination = process.argv[3];
if (!candidate || !destination)
  throw new Error('Usage: node scripts/quality/audit-harness-upgrade.mjs <candidate-node_modules> <report.json>');
const repo = resolve(import.meta.dirname, '../..');
const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
const candidateRoot = resolve(candidate);
const currentRoot = join(repo, 'apps/desktop/node_modules');
const packageInfo = (root, name) => {
  const file = join(root, name, 'package.json');
  if (!existsSync(file)) return null;
  const data = read(file);
  return { version: data.version, license: data.license, peerDependencies: data.peerDependencies ?? {} };
};
const desktop = read(join(repo, 'apps/desktop/package.json'));
const dependencies = Object.keys(desktop.dependencies)
  .filter((name) => name.startsWith('@deepseek-ai/'))
  .sort()
  .map((name) => ({
    name,
    current: packageInfo(currentRoot, name),
    candidate: packageInfo(candidateRoot, name),
  }));
const pinnedPlugins = ['plugins', 'client-plugins'].flatMap((folder) =>
  readdirSync(join(repo, folder), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(repo, folder, entry.name, 'package.json')))
    .flatMap((entry) => {
      const path = join(folder, entry.name, 'package.json');
      const manifest = read(join(repo, path));
      const pins = Object.entries({ ...manifest.dependencies, ...manifest.peerDependencies }).filter(([name]) =>
        name.startsWith('@deepseek-ai/'),
      );
      return pins.length ? [{ path, pins: Object.fromEntries(pins) }] : [];
    }),
);
const report = {
  checkedAt: new Date().toISOString(),
  current: packageInfo(currentRoot, '@deepseek-ai/dsh'),
  candidate: packageInfo(candidateRoot, '@deepseek-ai/dsh'),
  dependencyCount: dependencies.length,
  absentFromCandidateInstallation: dependencies.filter((item) => !item.candidate).map((item) => item.name),
  dependencies,
  pinnedPlugins,
  limits: [
    'Absence means not installed in this candidate closure, not necessarily unpublished.',
    'This inventory does not prove API, profile, native-module, or UI compatibility.',
  ],
};
writeFileSync(resolve(destination), JSON.stringify(report, null, 2) + '\n');
console.log(
  JSON.stringify(
    {
      current: report.current.version,
      candidate: report.candidate.version,
      checked: dependencies.length,
      absent: report.absentFromCandidateInstallation,
      pinnedPluginCount: pinnedPlugins.length,
    },
    null,
    2,
  ),
);
