import test from 'node:test';
import assert from 'node:assert/strict';
import { appendCapped, normalizeTerminalText } from '../src/tui/terminalRender.js';

test('normalizeTerminalText derives display text from raw terminal data', () => {
  assert.equal(normalizeTerminalText('\x1b[31mred\x1b[0m\r\nnext'), 'red\nnext');
});

test('appendCapped keeps recent raw output', () => {
  const value = appendCapped('abcdef', 'ghij', 5);
  assert.equal(Buffer.byteLength(value, 'utf8') <= 5, true);
  assert.equal(value.endsWith('hij'), true);
});
