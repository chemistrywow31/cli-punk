const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');
const CTRL_LETTER_OFFSET = 'a'.charCodeAt(0) - 1;
const CSI_U_RE = /^\x1b\[(\d+);(\d+)u$/;
const MODIFY_OTHER_KEYS_RE = /^\x1b\[27;(\d+);(\d+)~$/;
const ESC_PREFIX_SUPPRESSED = /^\x1b\[/;
const MACOS_OPTION_LETTERS = new Map([
  ['\u00e5', 'a'],
  ['\u222b', 'b'],
  ['\u00e7', 'c'],
  ['\u2202', 'd'],
  ['\u00b4', 'e'],
  ['\u0192', 'f'],
  ['\u00a9', 'g'],
  ['\u02d9', 'h'],
  ['\u02c6', 'i'],
  ['\u2206', 'j'],
  ['\u02da', 'k'],
  ['\u00ac', 'l'],
  ['\u00b5', 'm'],
  ['\u02dc', 'n'],
  ['\u00f8', 'o'],
  ['\u03c0', 'p'],
  ['\u0153', 'q'],
  ['\u00ae', 'r'],
  ['\u00df', 's'],
  ['\u2020', 't'],
  ['\u00a8', 'u'],
  ['\u221a', 'v'],
  ['\u2211', 'w'],
  ['\u2248', 'x'],
  ['\u00a5', 'y'],
  ['\u03a9', 'z'],
]);

export class HotkeyPool {
  constructor() {
    this.assignments = new Map();
    this.letterToSession = new Map();
  }

  assign(sessionId) {
    if (this.assignments.has(sessionId)) return this.assignments.get(sessionId);
    for (const letter of LETTERS) {
      if (!this.letterToSession.has(letter)) {
        this.assignments.set(sessionId, letter);
        this.letterToSession.set(letter, sessionId);
        return letter;
      }
    }
    return null;
  }

  free(sessionId) {
    const letter = this.assignments.get(sessionId);
    if (!letter) return;
    this.assignments.delete(sessionId);
    this.letterToSession.delete(letter);
  }

  getSession(letter) {
    return this.letterToSession.get(letter) || null;
  }

  clearMissing(sessionIds) {
    const active = new Set(sessionIds);
    for (const sessionId of [...this.assignments.keys()]) {
      if (!active.has(sessionId)) this.free(sessionId);
    }
  }
}

export function isReservedHotkey(key) {
  if (!key) return false;
  if (['`', 'n', 'p', 'w'].some((name) => isCtrlHotkey(key, name))) return true;
  if (getMetaLetter(key)) return true;
  if (isMetaHotkey(key, 'left') || isMetaHotkey(key, 'right')) return true;
  if (['f1', 'f2', 'f3', 'f4', 'f5', 'f9', 'escape'].some((name) => isNamedHotkey(key, name))) return true;
  return false;
}

export function sequenceForTerminal(ch, key) {
  if (key?.sequence) return key.sequence;
  if (typeof ch === 'string') return ch;
  return '';
}

export function isCtrlHotkey(key, name) {
  const target = normalizeName(name);
  const keyName = normalizeName(key?.name);
  if (!target) return false;
  if (key?.ctrl && keyName === target) return true;
  if (target === '`' && key?.ctrl && (keyName === '@' || keyName === 'space')) return true;
  if (normalizeFull(key?.full) === `c-${target}`) return true;
  if (target === '`' && ['c-@', 'c-space'].includes(normalizeFull(key?.full))) return true;
  if (target === '`' && key?.sequence === '\x00') return true;
  if (/^[a-z]$/.test(target) && key?.sequence === ctrlLetterSequence(target)) return true;
  return false;
}

export function isMetaHotkey(key, name) {
  const target = normalizeName(name);
  if (!target) return false;
  if ((key?.meta || key?.alt) && normalizeName(key.name) === target) return true;
  if ([`m-${target}`, `a-${target}`, `alt-${target}`].includes(normalizeFull(key?.full))) return true;
  return false;
}

export function getMetaLetter(key) {
  const keyName = normalizeName(key?.name);
  if ((key?.meta || key?.alt) && /^[a-z]$/.test(keyName)) return keyName;
  const fullMatch = /^(?:m|a|alt)-([a-z])$/.exec(normalizeFull(key?.full));
  if (fullMatch) return fullMatch[1];
  const sequenceMatch = /^\x1b([a-z])$/i.exec(key?.sequence || '');
  if (sequenceMatch) return sequenceMatch[1].toLowerCase();
  return null;
}

export function getMacOptionLetter(ch, key) {
  const value = String(key?.sequence || ch || '');
  return MACOS_OPTION_LETTERS.get(value) || null;
}

export function metaKeyFromEscapePrefix(ch, key = {}) {
  const keyName = normalizeName(key?.name);
  const sequence = String(key?.sequence || ch || '');
  if (/^[a-z]$/.test(keyName)) return buildSyntheticKey(keyName, { meta: true, sequence: `\x1b${sequence}` });
  if (/^[a-z]$/i.test(ch || '')) return buildSyntheticKey(ch.toLowerCase(), { meta: true, sequence: `\x1b${ch}` });
  if (['left', 'right'].includes(keyName)) return buildSyntheticKey(keyName, { meta: true, sequence: `\x1b${sequence}` });
  return null;
}

export function rawHotkeyFromData(data) {
  const sequence = rawDataToString(data);
  const csiMatch = CSI_U_RE.exec(sequence);
  if (csiMatch) {
    const key = keyFromCodepoint(Number(csiMatch[1]), Number(csiMatch[2]), sequence);
    return key ? { key, suppressKeypresses: suppressedKeypressCount(sequence) } : null;
  }

  const modifyOtherKeysMatch = MODIFY_OTHER_KEYS_RE.exec(sequence);
  if (modifyOtherKeysMatch) {
    const key = keyFromCodepoint(Number(modifyOtherKeysMatch[2]), Number(modifyOtherKeysMatch[1]), sequence);
    return key ? { key, suppressKeypresses: suppressedKeypressCount(sequence) } : null;
  }

  return null;
}

export function isNamedHotkey(key, name) {
  const target = normalizeName(name);
  return normalizeName(key?.name) === target || normalizeFull(key?.full) === target;
}

function normalizeName(value) {
  return String(value || '').toLowerCase();
}

function normalizeFull(value) {
  return String(value || '').toLowerCase();
}

function ctrlLetterSequence(letter) {
  return String.fromCharCode(letter.charCodeAt(0) - CTRL_LETTER_OFFSET);
}

function rawDataToString(data) {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  return String(data || '');
}

function keyFromCodepoint(codepoint, modifier, sequence) {
  if (!Number.isInteger(codepoint) || !Number.isInteger(modifier)) return null;
  let value;
  try {
    value = String.fromCodePoint(codepoint);
  } catch {
    return null;
  }

  const modifierBits = modifier - 1;
  const ctrl = Boolean(modifierBits & 4);
  const meta = Boolean(modifierBits & 2);
  const shift = Boolean(modifierBits & 1);
  const name = nameFromCodepointValue(value);
  if (!name || (!ctrl && !meta)) return null;
  return buildSyntheticKey(name, { ctrl, meta, shift, sequence });
}

function buildSyntheticKey(name, { ctrl = false, meta = false, shift = false, sequence = '' } = {}) {
  return {
    sequence,
    name,
    ctrl,
    meta,
    shift,
    full: `${ctrl ? 'C-' : ''}${meta ? 'M-' : ''}${shift ? 'S-' : ''}${name}`,
  };
}

function nameFromCodepointValue(value) {
  if (/^[a-z]$/i.test(value)) return value.toLowerCase();
  if (value === '`') return '`';
  if (value === ' ') return 'space';
  return null;
}

function suppressedKeypressCount(sequence) {
  if (!ESC_PREFIX_SUPPRESSED.test(sequence)) return 0;
  return Math.max(0, sequence.length - 2);
}
