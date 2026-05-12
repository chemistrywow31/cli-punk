import test from 'node:test';
import assert from 'node:assert/strict';
import {
  backendPathPrefix,
  classifySocketClose,
  defaultWebSocketUrl,
  isBackendUnavailableError,
} from '../src/services/websocket.js';
import wsService from '../src/services/websocket.js';

test('classifySocketClose separates missing token, auth rejection, and offline backend', () => {
  assert.equal(classifySocketClose({ hasToken: false, code: 1006 }), 'auth required');
  assert.equal(classifySocketClose({ hasToken: true, code: 1008, opened: false }), 'auth invalid');
  assert.equal(classifySocketClose({
    hasToken: true,
    code: 1006,
    opened: false,
    authMode: 'query-token',
  }), 'auth invalid');
  assert.equal(classifySocketClose({
    hasToken: true,
    code: 1006,
    opened: false,
    authMode: 'browser-session',
  }), 'offline');
});

test('backend unavailable auth-session errors are distinct from invalid tokens', () => {
  assert.equal(isBackendUnavailableError({ code: 'BACKEND_UNAVAILABLE' }), true);
  assert.equal(isBackendUnavailableError({ status: 0 }), true);
  assert.equal(isBackendUnavailableError({ status: 401 }), false);
  assert.equal(isBackendUnavailableError({ status: 403 }), false);
});

test('backendPathPrefix detects /cp browser mounts', () => {
  assert.equal(backendPathPrefix('/'), '');
  assert.equal(backendPathPrefix('/workbench'), '');
  assert.equal(backendPathPrefix('/cp'), '/cp');
  assert.equal(backendPathPrefix('/cp/'), '/cp');
  assert.equal(backendPathPrefix('/cp/session'), '/cp');
});

test('defaultWebSocketUrl uses current browser origin and /cp prefix', () => {
  const previousWindow = globalThis.window;
  globalThis.window = {
    location: {
      protocol: 'https:',
      host: 'example.test',
      pathname: '/cp/',
    },
  };

  try {
    assert.equal(defaultWebSocketUrl(), 'wss://example.test/cp/ws');
  } finally {
    globalThis.window = previousWindow;
  }
});

test('auth token is kept in memory only', () => {
  wsService.clearToken();
  wsService.setToken('cp_memory_only');
  assert.equal(wsService.getToken(), 'cp_memory_only');

  wsService.clearToken();
  assert.equal(wsService.getToken(), '');
});
