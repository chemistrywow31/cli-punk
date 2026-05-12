import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

const BACKEND_DIR = path.resolve(import.meta.dirname, '..');

test('REST auth protects /api and supports token lifecycle', async () => {
  const fixture = await startBackend();
  try {
    assert.deepEqual(await requestJson(fixture.url, '/health'), { ok: true });

    const missing = await requestJson(fixture.url, '/api/sessions', { expectedStatus: 401 });
    assert.deepEqual(missing, { error: 'AUTH_REQUIRED' });

    const invalid = await requestJson(fixture.url, '/api/sessions', {
      token: 'cp_invalid',
      expectedStatus: 401,
    });
    assert.deepEqual(invalid, { error: 'AUTH_INVALID' });

    const identity = await requestJson(fixture.url, '/api/auth/whoami', { token: fixture.adminToken });
    assert.equal(identity.role, 'admin');
    assert.equal(identity.hash, undefined);

    const viewer = await requestJson(fixture.url, '/api/tokens', {
      method: 'POST',
      token: fixture.adminToken,
      body: { name: 'viewer-test', role: 'viewer' },
      expectedStatus: 201,
    });
    assert.equal(viewer.role, 'viewer');
    assert.match(viewer.token, /^cp_/);

    const viewerCreate = await requestJson(fixture.url, '/api/sessions', {
      method: 'POST',
      token: viewer.token,
      body: { workDir: fixture.tmpDir, label: 'denied' },
      expectedStatus: 403,
    });
    assert.deepEqual(viewerCreate, { error: 'AUTH_FORBIDDEN' });

    const listed = await requestJson(fixture.url, '/api/tokens', { token: fixture.adminToken });
    assert.equal(Array.isArray(listed.tokens), true);
    assert.equal(listed.tokens.some((token) => token.id === viewer.id), true);
    assert.equal(listed.tokens.some((token) => token.token), false);

    await requestJson(fixture.url, `/api/tokens/${encodeURIComponent(viewer.id)}`, {
      method: 'DELETE',
      token: fixture.adminToken,
    });

    const revoked = await requestJson(fixture.url, '/api/auth/whoami', {
      token: viewer.token,
      expectedStatus: 401,
    });
    assert.deepEqual(revoked, { error: 'AUTH_INVALID' });

    const bearerWithStaleCookie = await requestJson(fixture.url, '/api/auth/whoami', {
      token: fixture.adminToken,
      cookie: 'claude_punk_session=stale',
      origin: 'https://cp.fans-pilot.com',
    });
    assert.equal(bearerWithStaleCookie.role, 'admin');
  } finally {
    await fixture.stop();
  }
});

test('/cp prefixed REST and WebSocket routes are accepted', async () => {
  const fixture = await startBackend();
  try {
    const identity = await requestJson(fixture.url, '/cp/api/auth/whoami', { token: fixture.adminToken });
    assert.equal(identity.role, 'admin');

    const ws = await openWs(`${fixture.cpWsUrl}?token=${encodeURIComponent(fixture.adminToken)}`);
    ws.close();
  } finally {
    await fixture.stop();
  }
});

test('WebSocket auth rejects missing tokens and gates viewer writes', async () => {
  const fixture = await startBackend();
  try {
    await assert.rejects(
      () => openWs(fixture.wsUrl),
      /Unexpected server response: 401/,
    );

    const viewer = await requestJson(fixture.url, '/api/tokens', {
      method: 'POST',
      token: fixture.adminToken,
      body: { name: 'viewer-ws', role: 'viewer' },
      expectedStatus: 201,
    });

    const ws = await openWs(`${fixture.wsUrl}?token=${encodeURIComponent(viewer.token)}`);
    try {
      const error = waitForMessage(ws, 'error');
      ws.send(JSON.stringify({
        type: 'terminal.input',
        payload: { sessionId: 'missing', data: 'x' },
        timestamp: new Date().toISOString(),
      }));
      assert.deepEqual(await error, { message: 'Forbidden', code: 'AUTH_FORBIDDEN' });
    } finally {
      ws.close();
    }
  } finally {
    await fixture.stop();
  }
});

test('browser session cookie authenticates REST and WebSocket without URL tokens', async () => {
  const fixture = await startBackend();
  try {
    const { body, response } = await requestJson(fixture.url, '/api/auth/browser-session', {
      method: 'POST',
      token: fixture.adminToken,
      includeResponse: true,
    });
    assert.equal(body.ok, true);
    assert.equal(body.auth.role, 'admin');

    const setCookie = response.headers.get('set-cookie');
    assert.match(setCookie, /claude_punk_session=/);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
    assert.equal(setCookie.includes(fixture.adminToken), false);

    const cookie = setCookie.split(';')[0];
    const identity = await requestJson(fixture.url, '/api/auth/whoami', { cookie });
    assert.equal(identity.role, 'admin');

    const ws = await openWs(fixture.wsUrl, {
      headers: {
        cookie,
        origin: fixture.url,
      },
    });
    ws.close();
  } finally {
    await fixture.stop();
  }
});

test('project env admin token rotates without regenerating user-scope keys', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cli-punk-env-auth-test-'));
  const envFile = path.join(tmpDir, '.env');
  const authDir = path.join(tmpDir, 'auth-state');
  await fs.writeFile(envFile, 'CLAUDE_PUNK_ADMIN_TOKEN=dev-one\n');

  const fixture = await startBackend({
    adminToken: 'dev-one',
    env: {
      CLAUDE_PUNK_ENV_FILE: envFile,
      CLAUDE_PUNK_AUTH_DIR: authDir,
    },
  });

  try {
    const identity = await requestJson(fixture.url, '/api/auth/whoami', { token: 'dev-one' });
    assert.equal(identity.role, 'admin');
    assert.match(identity.id, /^env_admin_/);

    const listed = await requestJson(fixture.url, '/api/tokens', { token: 'dev-one' });
    assert.equal(listed.tokens.some((token) => token.id === identity.id && token.name === 'env-admin'), true);
    assert.equal(listed.tokens.some((token) => token.token), false);

    const { response } = await requestJson(fixture.url, '/api/auth/browser-session', {
      method: 'POST',
      token: 'dev-one',
      includeResponse: true,
    });
    const cookie = response.headers.get('set-cookie').split(';')[0];

    await fs.writeFile(envFile, 'CLAUDE_PUNK_ADMIN_TOKEN=dev-two\n');

    const oldToken = await requestJson(fixture.url, '/api/auth/whoami', {
      token: 'dev-one',
      expectedStatus: 401,
    });
    assert.deepEqual(oldToken, { error: 'AUTH_INVALID' });

    const oldCookie = await requestJson(fixture.url, '/api/auth/whoami', {
      cookie,
      expectedStatus: 401,
    });
    assert.deepEqual(oldCookie, { error: 'AUTH_INVALID' });

    const rotated = await requestJson(fixture.url, '/api/auth/whoami', { token: 'dev-two' });
    assert.equal(rotated.role, 'admin');
    assert.notEqual(rotated.id, identity.id);
  } finally {
    await fixture.stop();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('file operations reject traversal, prefix siblings, and symlink escapes', async (t) => {
  const fixture = await startBackend();
  const workDir = await fs.mkdtemp(path.join(fixture.tmpDir, 'repo-'));
  const siblingDir = `${workDir}-other`;
  await fs.mkdir(siblingDir);
  await fs.writeFile(path.join(workDir, 'inside.txt'), 'inside');
  await fs.writeFile(path.join(siblingDir, 'outside.txt'), 'outside');

  let sessionId = null;
  try {
    const operator = await requestJson(fixture.url, '/api/tokens', {
      method: 'POST',
      token: fixture.adminToken,
      body: { name: 'operator-path', role: 'operator' },
      expectedStatus: 201,
    });

    const session = await requestJson(fixture.url, '/api/sessions', {
      method: 'POST',
      token: operator.token,
      body: { workDir, label: 'path-safety', agentType: 'claude' },
      expectedStatus: 201,
    });
    sessionId = session.id;

    const ws = await openWs(fixture.wsUrl, operator.token);
    try {
      await requestWs(ws, 'file.write', { sessionId, filePath: 'ok.txt', content: 'ok' }, 'file.saved');
      assert.equal(await fs.readFile(path.join(workDir, 'ok.txt'), 'utf8'), 'ok');

      const traversal = await requestWsError(ws, 'file.write', {
        sessionId,
        filePath: '../outside.txt',
        content: 'bad',
      });
      assert.equal(traversal.code, 'INVALID_MESSAGE');

      const prefixSibling = await requestWsError(ws, 'file.read', {
        sessionId,
        filePath: path.join(siblingDir, 'outside.txt'),
      });
      assert.equal(prefixSibling.code, 'INVALID_MESSAGE');

      const outside = path.join(fixture.tmpDir, 'outside-target.txt');
      await fs.writeFile(outside, 'secret');
      try {
        await fs.symlink(outside, path.join(workDir, 'escape-link'));
        const symlinkEscape = await requestWsError(ws, 'file.read', {
          sessionId,
          filePath: 'escape-link',
        });
        assert.equal(symlinkEscape.code, 'INVALID_MESSAGE');
      } catch (err) {
        if (err.code !== 'EPERM' && err.code !== 'EACCES') throw err;
        t.diagnostic('symlink creation not permitted on this platform');
      }
    } finally {
      ws.close();
    }
  } finally {
    if (sessionId) {
      await requestJson(fixture.url, `/api/sessions/${encodeURIComponent(sessionId)}`, {
        method: 'DELETE',
        token: fixture.adminToken,
      }).catch(() => {});
    }
    await fixture.stop();
  }
});

async function startBackend(options = {}) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cli-punk-auth-test-'));
  const port = await getAvailablePort();
  const env = {
    ...process.env,
    HOME: tmpDir,
    USERPROFILE: tmpDir,
    PORT: String(port),
    AUTO_RUN_CLAUDE: 'false',
    CLAUDE_PUNK_ENV_FILE: path.join(tmpDir, '.env'),
    CLAUDE_PUNK_ADMIN_TOKEN: '',
    CLAUDE_PUNK_AUTH_KEY: '',
    CLAUDE_PUNK_DEV_TOKEN: '',
    ...options.env,
  };
  const child = spawn(process.execPath, ['server.js'], {
    cwd: BACKEND_DIR,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  let adminToken = null;
  let ready = false;

  const wait = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`backend did not start\n${output}`)), 15000);
    const onData = (chunk) => {
      output += chunk.toString();
      adminToken ||= /Initial admin token: (cp_[^\s]+)/.exec(output)?.[1] || null;
      ready ||= output.includes('Backend running on');
      if ((adminToken || options.adminToken) && ready) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`backend exited early code=${code} signal=${signal}\n${output}`));
    });
  });

  await wait;

  return {
    tmpDir,
    port,
    url: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}/ws`,
    cpWsUrl: `ws://127.0.0.1:${port}/cp/ws`,
    adminToken: options.adminToken || adminToken,
    child,
    async stop() {
      if (child.exitCode !== null || child.signalCode) return;
      child.kill('SIGTERM');
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          resolve();
        }, 3000);
        child.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
      await fs.rm(tmpDir, { recursive: true, force: true });
    },
  };
}

async function getAvailablePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function requestJson(baseUrl, route, options = {}) {
  const headers = { accept: 'application/json' };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.cookie) headers.cookie = options.cookie;
  if (options.origin) headers.origin = options.origin;
  const response = await fetch(new URL(route, `${baseUrl}/`), {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  assert.equal(response.status, options.expectedStatus || 200, text);
  if (options.includeResponse) return { body, response };
  return body;
}

function openWs(wsUrl, tokenOrOptions = null) {
  return new Promise((resolve, reject) => {
    const headers = typeof tokenOrOptions === 'string'
      ? { authorization: `Bearer ${tokenOrOptions}` }
      : tokenOrOptions?.headers || {};
    const ws = new WebSocket(wsUrl, { headers });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
    ws.once('unexpected-response', (_req, res) => {
      reject(new Error(`Unexpected server response: ${res.statusCode}`));
    });
  });
}

function waitForMessage(ws, type) {
  return new Promise((resolve) => {
    const onMessage = (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type !== type) return;
      ws.off('message', onMessage);
      resolve(msg.payload);
    };
    ws.on('message', onMessage);
  });
}

async function requestWs(ws, type, payload, successType) {
  const success = waitForMessage(ws, successType);
  ws.send(JSON.stringify({ type, payload, timestamp: new Date().toISOString() }));
  return success;
}

async function requestWsError(ws, type, payload) {
  const error = waitForMessage(ws, 'error');
  ws.send(JSON.stringify({ type, payload, timestamp: new Date().toISOString() }));
  return error;
}
