import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeServerUrl } from '../src/config.js';
import { request } from '../src/api.js';
import { buildWebSocketUrl } from '../src/wsClient.js';

test('normalizeServerUrl removes trailing slash, query, and hash', () => {
  assert.equal(normalizeServerUrl('http://127.0.0.1:3000/?x=1#hash'), 'http://127.0.0.1:3000');
});

test('buildWebSocketUrl preserves host and maps protocol to /ws', () => {
  assert.equal(buildWebSocketUrl('http://127.0.0.1:3000'), 'ws://127.0.0.1:3000/ws');
  assert.equal(buildWebSocketUrl('https://example.test/base'), 'wss://example.test/base/ws');
  assert.equal(buildWebSocketUrl('https://example.test/cp'), 'wss://example.test/cp/ws');
});

test('request preserves server base path for /cp deployments', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.equal(url.toString(), 'https://example.test/cp/api/sessions');
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    await request('GET', '/api/sessions', { serverUrl: 'https://example.test/cp' });
  } finally {
    globalThis.fetch = previousFetch;
  }
});
