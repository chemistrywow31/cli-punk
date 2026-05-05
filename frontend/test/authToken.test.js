import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAuthTokenInput } from '../src/authToken.js';

test('parseAuthTokenInput accepts a plain token', () => {
  assert.equal(parseAuthTokenInput('cp_plain'), 'cp_plain');
});

test('parseAuthTokenInput extracts auth keys from dotenv snippets', () => {
  assert.equal(parseAuthTokenInput(`
# CLI Punk local auth.
CLAUDE_PUNK_ADMIN_TOKEN=cp_admin
CLAUDE_PUNK_AUTH_DIR=.cli-punk-auth
`), 'cp_admin');
});

test('parseAuthTokenInput handles export, quotes, and inline comments', () => {
  assert.equal(parseAuthTokenInput('export CLAUDE_PUNK_AUTH_KEY="cp_quoted" # rotate me'), 'cp_quoted');
  assert.equal(parseAuthTokenInput("CLAUDE_PUNK_DEV_TOKEN='cp_dev'"), 'cp_dev');
});

test('parseAuthTokenInput extracts token from collapsed single-line dotenv paste', () => {
  assert.equal(
    parseAuthTokenInput('# local auth CLAUDE_PUNK_ADMIN_TOKEN=cp_inline CLAUDE_PUNK_AUTH_DIR=.cli-punk-auth'),
    'cp_inline',
  );
});

test('parseAuthTokenInput strips bearer prefix', () => {
  assert.equal(parseAuthTokenInput('Bearer cp_header'), 'cp_header');
});
