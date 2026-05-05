import test from 'node:test';
import assert from 'node:assert/strict';
import { flattenTree, formatBytes, quoteShellPath } from '../src/tree.js';

const tree = [
  {
    name: 'src',
    path: 'src',
    isDir: true,
    children: [
      { name: 'index.js', path: 'src/index.js', isDir: false, size: 128 },
      { name: 'space name.js', path: 'src/space name.js', isDir: false, size: 64 },
    ],
  },
  { name: 'README.md', path: 'README.md', isDir: false, size: 2048 },
];

test('flattenTree respects expanded directories', () => {
  assert.deepEqual(flattenTree(tree).map((row) => row.path), ['src', 'README.md']);
  assert.deepEqual(
    flattenTree(tree, { expanded: new Set(['src']) }).map((row) => row.path),
    ['src', 'src/index.js', 'src/space name.js', 'README.md'],
  );
});

test('flattenTree includes matching children while filtering', () => {
  assert.deepEqual(flattenTree(tree, { filter: 'space' }).map((row) => row.path), ['src', 'src/space name.js']);
});

test('formatBytes and quoteShellPath produce terminal-safe labels', () => {
  assert.equal(formatBytes(2048), '2.0K');
  assert.equal(quoteShellPath('src/index.js'), 'src/index.js');
  assert.equal(quoteShellPath('src/space name.js'), "'src/space name.js'");
});
