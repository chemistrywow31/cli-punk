import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySocketClose, isBackendUnavailableError } from '../src/services/websocket.js';

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
