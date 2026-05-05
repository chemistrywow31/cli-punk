import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const OLD_CLAUDE_FLAG = ['--dangerously', '-skip-permissions'].join('');
const OLD_CODEX_FLAG = ['--full', '-auto'].join('');

test('agent auto-run commands use current CLI automation flags', async () => {
  const serverSource = await fs.readFile(path.join(REPO_ROOT, 'backend/server.js'), 'utf8');

  assert.equal(serverSource.includes("claude: `${resolveCommand('claude')} --enable-auto-mode`"), true);
  assert.equal(serverSource.includes("codex: `${resolveCommand('codex')} --yolo`"), true);
  assert.equal(serverSource.includes(OLD_CLAUDE_FLAG), false);
  assert.equal(serverSource.includes(OLD_CODEX_FLAG), false);
});
