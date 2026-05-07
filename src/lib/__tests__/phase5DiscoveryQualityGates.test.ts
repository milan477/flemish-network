import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceRoot = resolve(process.cwd(), 'src');
const scannedRoots = ['components', 'lib', 'pages'].map((path) => join(sourceRoot, path));
const sourceExtensions = new Set(['.ts', '.tsx']);
const legacyDiscoveryTerms = [
  'discover-contacts',
  'search-contacts',
  'parse_contacts',
  'flemish_search',
];

function extensionFor(path: string): string {
  const match = path.match(/\.[^.]+$/);
  return match ? match[0] : '';
}

function collectSourceFiles(path: string): string[] {
  const stat = statSync(path);
  if (stat.isFile()) return sourceExtensions.has(extensionFor(path)) ? [path] : [];
  if (!stat.isDirectory()) return [];
  if (path.includes(`${join('src', 'lib', '__tests__')}`)) return [];

  return readdirSync(path).flatMap((entry) => collectSourceFiles(join(path, entry)));
}

describe('Phase 5E Discovery quality gates', () => {
  it('keeps active UI source free of legacy Discovery callers', () => {
    const offenders = scannedRoots
      .flatMap(collectSourceFiles)
      .flatMap((filePath) => {
        const source = readFileSync(filePath, 'utf8');
        return legacyDiscoveryTerms
          .filter((term) => source.includes(term))
          .map((term) => `${relative(process.cwd(), filePath)}: ${term}`);
      });

    expect(offenders).toEqual([]);
  });
});
