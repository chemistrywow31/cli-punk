import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HotkeyPool,
  getMacOptionLetter,
  getMetaLetter,
  isCtrlHotkey,
  isMetaHotkey,
  isReservedHotkey,
  metaKeyFromEscapePrefix,
  rawHotkeyFromData,
  sequenceForTerminal,
} from '../src/hotkeys.js';

test('HotkeyPool assigns and recycles letters in order', () => {
  const pool = new HotkeyPool();
  assert.equal(pool.assign('s1'), 'a');
  assert.equal(pool.assign('s2'), 'b');
  assert.equal(pool.assign('s1'), 'a');
  pool.free('s1');
  assert.equal(pool.assign('s3'), 'a');
  assert.equal(pool.getSession('a'), 's3');
});

test('reserved hotkeys are detected before PTY forwarding', () => {
  assert.equal(isReservedHotkey({ ctrl: true, name: 'n' }), true);
  assert.equal(isReservedHotkey({ full: 'C-n' }), true);
  assert.equal(isReservedHotkey({ sequence: '\x0e' }), true);
  assert.equal(isReservedHotkey({ meta: true, name: 'a' }), true);
  assert.equal(isReservedHotkey({ alt: true, name: 'a' }), true);
  assert.equal(isReservedHotkey({ full: 'M-a' }), true);
  assert.equal(isReservedHotkey({ full: 'Alt-a' }), true);
  assert.equal(isReservedHotkey({ sequence: '\x1ba' }), true);
  assert.equal(isReservedHotkey({ meta: true, name: 'left' }), true);
  assert.equal(isReservedHotkey({ name: 'f9' }), true);
  assert.equal(isReservedHotkey({ name: 'x' }), false);
});

test('ctrl hotkeys normalize blessed parser variants', () => {
  assert.equal(isCtrlHotkey({ ctrl: true, name: 'n' }, 'n'), true);
  assert.equal(isCtrlHotkey({ full: 'C-n' }, 'n'), true);
  assert.equal(isCtrlHotkey({ sequence: '\x0e' }, 'n'), true);
  assert.equal(isCtrlHotkey({ sequence: '\x00' }, '`'), true);
  assert.equal(isCtrlHotkey({ ctrl: true, name: 'space' }, '`'), true);
  assert.equal(isCtrlHotkey({ full: 'C-@' }, '`'), true);
  assert.equal(isCtrlHotkey({ full: 'C-p' }, 'n'), false);
});

test('meta hotkeys normalize letters and arrows', () => {
  assert.equal(getMetaLetter({ meta: true, name: 'a' }), 'a');
  assert.equal(getMetaLetter({ alt: true, name: 'a' }), 'a');
  assert.equal(getMetaLetter({ full: 'M-B' }), 'b');
  assert.equal(getMetaLetter({ full: 'Alt-c' }), 'c');
  assert.equal(getMetaLetter({ sequence: '\x1bc' }), 'c');
  assert.equal(isMetaHotkey({ meta: true, name: 'right' }, 'right'), true);
  assert.equal(isMetaHotkey({ alt: true, name: 'left' }, 'left'), true);
  assert.equal(isMetaHotkey({ full: 'M-left' }, 'left'), true);
});

test('raw terminal CSI-u and modifyOtherKeys hotkeys are normalized', () => {
  const altA = rawHotkeyFromData(Buffer.from('\x1b[97;3u'));
  assert.equal(altA.key.name, 'a');
  assert.equal(altA.key.meta, true);
  assert.equal(altA.suppressKeypresses, 5);
  assert.equal(getMetaLetter(altA.key), 'a');

  const ctrlBacktick = rawHotkeyFromData(Buffer.from('\x1b[96;5u'));
  assert.equal(ctrlBacktick.key.name, '`');
  assert.equal(ctrlBacktick.key.ctrl, true);
  assert.equal(ctrlBacktick.suppressKeypresses, 5);
  assert.equal(isCtrlHotkey(ctrlBacktick.key, '`'), true);

  const altB = rawHotkeyFromData(Buffer.from('\x1b[27;3;98~'));
  assert.equal(altB.key.name, 'b');
  assert.equal(altB.key.meta, true);
  assert.equal(altB.suppressKeypresses, 8);
});

test('split escape prefix can synthesize meta hotkeys', () => {
  assert.equal(getMetaLetter(metaKeyFromEscapePrefix('a', { name: 'a', sequence: 'a' })), 'a');
  assert.equal(isMetaHotkey(metaKeyFromEscapePrefix(null, { name: 'left', sequence: '\x1b[D' }), 'left'), true);
});

test('macOS option letter fallback maps common Alt-generated characters', () => {
  assert.equal(getMacOptionLetter('\u00e5', {}), 'a');
  assert.equal(getMacOptionLetter('\u222b', {}), 'b');
  assert.equal(getMacOptionLetter('\u00e7', {}), 'c');
});

test('terminal input preserves parser sequence when available', () => {
  assert.equal(sequenceForTerminal('x', { sequence: '\x1b[A' }), '\x1b[A');
  assert.equal(sequenceForTerminal('x', {}), 'x');
});
