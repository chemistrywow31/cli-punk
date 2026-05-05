import test from 'node:test';
import assert from 'node:assert/strict';
import { TuiApp } from '../src/tui/app.js';

test('TuiApp handles Ctrl+N parser variants before reserved-key fallback', () => {
  const app = new TuiApp({ reconnect: false });
  let created = 0;
  let forwarded = '';
  app._newSessionFlow = () => { created += 1; };
  app._sendTerminalInput = (data) => { forwarded += data; };

  app._handleKeypress(null, { full: 'C-n' });
  app._handleKeypress(null, { sequence: '\x0e' });

  assert.equal(created, 2);
  assert.equal(forwarded, '');
});

test('TuiApp routes Alt+letter parser variants to assigned sessions', () => {
  const app = new TuiApp({ reconnect: false });
  app.hotkeys.assign('session-a');
  let active = null;
  app.setActiveSession = (sessionId) => { active = sessionId; };

  app._handleKeypress(null, { full: 'M-a' });

  assert.equal(active, 'session-a');
});

test('TuiApp routes raw CSI-u Alt+letter and suppresses blessed residue', () => {
  const app = new TuiApp({ reconnect: false });
  app.hotkeys.assign('session-a');
  let active = null;
  let forwarded = '';
  app.setActiveSession = (sessionId) => { active = sessionId; };
  app._sendTerminalInput = (data) => { forwarded += data; };

  app._handleRawInputData(Buffer.from('\x1b[97;3u'));
  for (const ch of ['9', '7', ';', '3', 'u']) {
    app._handleKeypress(ch, { name: ch, sequence: ch });
  }

  assert.equal(active, 'session-a');
  assert.equal(forwarded, '');
});

test('TuiApp routes split Escape+letter as Alt+letter', () => {
  const app = new TuiApp({ reconnect: false });
  app.hotkeys.assign('session-a');
  app.hotkeys.assign('session-b');
  let active = null;
  let forwarded = '';
  app.setActiveSession = (sessionId) => { active = sessionId; };
  app._sendTerminalInput = (data) => { forwarded += data; };

  app._handleKeypress('\x1b', { name: 'escape', sequence: '\x1b' });
  app._handleKeypress('b', { name: 'b', sequence: 'b' });

  assert.equal(active, 'session-b');
  assert.equal(forwarded, '');
});

test('TuiApp handles macOS Option-generated letters as session hotkeys', () => {
  const app = new TuiApp({ reconnect: false });
  app.hotkeys.assign('session-a');
  app.hotkeys.assign('session-b');
  app.hotkeys.assign('session-c');
  let active = null;
  let forwarded = '';
  app.setActiveSession = (sessionId) => { active = sessionId; };
  app._sendTerminalInput = (data) => { forwarded += data; };

  app._handleKeypress('\u00e7', { sequence: '\u00e7' });

  assert.equal(active, 'session-c');
  assert.equal(forwarded, '');
});

test('TuiApp closes prompt modal on Ctrl+Backtick variants', () => {
  const app = new TuiApp({ reconnect: false });
  const hidden = [];
  app.mode = 'prompt';
  app.focusPane = 'files';
  app.prompt = { hide: () => hidden.push('prompt') };
  app.confirm = { hide: () => hidden.push('confirm') };
  app.screen = { program: { hideCursor: () => hidden.push('cursor') } };
  app._notify = () => {};
  app._render = () => {};

  app._handleKeypress(null, { sequence: '\x00' });

  assert.equal(app.mode, 'terminal');
  assert.equal(app.focusPane, 'terminal');
  assert.deepEqual(hidden, ['prompt', 'confirm', 'cursor']);
});
