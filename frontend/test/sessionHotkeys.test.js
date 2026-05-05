import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatSessionHotkey,
  nextSessionHotkey,
  sessionHotkeyFromEvent,
} from '../src/sessionHotkeys.js';

test('nextSessionHotkey assigns numeric Alt keys in order', () => {
  assert.equal(nextSessionHotkey(new Map()), '1');
  assert.equal(nextSessionHotkey(new Map([['1', 's1'], ['2', 's2']])), '3');
  assert.equal(
    nextSessionHotkey(new Map('1234567890'.split('').map((key) => [key, `s-${key}`]))),
    '',
  );
});

test('sessionHotkeyFromEvent accepts Alt+digits only', () => {
  assert.equal(sessionHotkeyFromEvent({ altKey: true, key: '1' }), '1');
  assert.equal(sessionHotkeyFromEvent({ altKey: true, key: '0' }), '0');
  assert.equal(sessionHotkeyFromEvent({ altKey: true, key: 'a' }), '');
  assert.equal(sessionHotkeyFromEvent({ altKey: false, key: '1' }), '');
  assert.equal(sessionHotkeyFromEvent({ altKey: true, ctrlKey: true, key: '1' }), '');
});

test('formatSessionHotkey renders numeric labels', () => {
  assert.equal(formatSessionHotkey('1'), 'Alt+1');
  assert.equal(formatSessionHotkey(''), '-');
});
