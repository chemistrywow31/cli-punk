/**
 * Claude Punk — Backend Server
 *
 * Single-file Node.js backend that manages Claude CLI sessions via PTY,
 * watches file systems, and communicates with the Phaser.js frontend over
 * raw WebSocket using a JSON envelope protocol: { type, payload, timestamp }.
 */

import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import * as pty from 'node-pty';
import chokidar from 'chokidar';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { execSync } from 'node:child_process';
import http from 'node:http';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

// ─── Section 1: Config ───────────────────────────────────────────────────────

const IS_WINDOWS = process.platform === 'win32';
const BACKEND_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(BACKEND_DIR, '..');
const AUTH_ENV_KEYS = Object.freeze([
  'CLAUDE_PUNK_ADMIN_TOKEN',
  'CLAUDE_PUNK_AUTH_KEY',
  'CLAUDE_PUNK_DEV_TOKEN',
]);

function dotenvPaths() {
  if (process.env.CLAUDE_PUNK_ENV_FILE) {
    return [path.resolve(process.env.CLAUDE_PUNK_ENV_FILE)];
  }
  return [
    path.join(BACKEND_DIR, '.env'),
    path.join(PROJECT_ROOT, '.env'),
  ];
}

function parseDotenvContent(content) {
  const values = {};
  for (const rawLine of String(content || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    let value = rawValue.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '');
    }
    values[key] = value;
  }
  return values;
}

function readDotenvFilesSync(pathsToRead = dotenvPaths()) {
  const values = {};
  for (const envPath of pathsToRead) {
    try {
      Object.assign(values, parseDotenvContent(fs.readFileSync(envPath, 'utf8')));
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn(`[config] Could not read ${envPath}: ${err.message}`);
    }
  }
  return values;
}

function loadDotenvIntoProcess() {
  const values = readDotenvFilesSync();
  for (const [key, value] of Object.entries(values)) {
    if (AUTH_ENV_KEYS.includes(key)) continue;
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotenvIntoProcess();

function resolveProjectPath(value, fallback) {
  if (!value) return fallback;
  return path.isAbsolute(value) ? value : path.resolve(PROJECT_ROOT, value);
}

// ── Shell detection (runs once at startup, sets flags for everything else) ───

/** Detect the default shell for the current platform. */
function detectShell() {
  if (IS_WINDOWS) {
    if (process.env.CLAUDE_PUNK_SHELL) return process.env.CLAUDE_PUNK_SHELL;

    const gitBashPaths = [
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Git', 'bin', 'bash.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'bin', 'bash.exe'),
    ];
    for (const p of gitBashPaths) {
      try {
        fs.accessSync(p, fs.constants.X_OK);
        console.log(`[config] Found Git Bash at ${p}`);
        return p;
      } catch { /* not found, try next */ }
    }

    return process.env.COMSPEC || 'cmd.exe';
  }
  return process.env.SHELL || '/bin/zsh';
}

const DETECTED_SHELL = detectShell();
const IS_GIT_BASH = IS_WINDOWS && DETECTED_SHELL.toLowerCase().includes('bash');

console.log(`[config] Shell: ${DETECTED_SHELL} (IS_GIT_BASH=${IS_GIT_BASH})`);

/** Get shell arguments for the current platform. */
function getShellArgs() {
  if (IS_WINDOWS) return IS_GIT_BASH ? ['--login'] : [];
  return ['-l'];
}

/** Resolve a CLI command to its absolute path, falling back to the bare name. */
function resolveCommand(name) {
  if (IS_GIT_BASH) {
    // Git Bash: `which` first (matches what the PTY shell actually sees)
    try {
      const result = execSync(`"${DETECTED_SHELL}" -lc "which ${name}"`, { encoding: 'utf8' }).trim();
      if (result && !result.includes('not found')) return result;
    } catch { /* not found via Git Bash PATH */ }
    // Fallback to Windows `where`
    try {
      const result = execSync(`where ${name}`, { encoding: 'utf8' }).trim();
      const resolved = result.split(/\r?\n/)[0];
      if (resolved) return resolved;
    } catch { /* not found via Windows PATH either */ }
  } else if (IS_WINDOWS) {
    // cmd.exe / PowerShell: `where` only
    try {
      const result = execSync(`where ${name}`, { encoding: 'utf8' }).trim();
      const resolved = result.split(/\r?\n/)[0];
      if (resolved) return resolved;
    } catch { /* not found */ }
  } else {
    // Unix: `which`
    try {
      const result = execSync(`which ${name}`, { encoding: 'utf8' }).trim();
      if (result) return result;
    } catch { /* not found */ }
  }

  console.warn(`[config] Could not resolve command "${name}" — using bare name as fallback`);
  return name;
}

/**
 * Build a PATH string that includes directories of all resolved agent commands.
 * On Windows, Git Bash's login profile can rebuild PATH and drop user-specific
 * directories (e.g. ~/.local/bin), causing agent commands to be unfindable.
 */
function buildEnhancedPath() {
  const currentPath = process.env.PATH || '';
  const extraDirs = new Set();

  for (const name of ['claude', 'codex']) {
    const resolved = resolveCommand(name);
    if (resolved && resolved !== name) {
      extraDirs.add(path.dirname(resolved));
    }
  }

  if (extraDirs.size === 0) return currentPath;

  const sep = IS_WINDOWS ? ';' : ':';
  const existing = new Set(currentPath.split(sep).map(p => p.toLowerCase()));
  const toAdd = [...extraDirs].filter(d => !existing.has(d.toLowerCase()));

  if (toAdd.length === 0) return currentPath;

  console.log(`[config] Adding to PATH for PTY: ${toAdd.join(sep)}`);
  return toAdd.join(sep) + sep + currentPath;
}

const _enhancedPath = buildEnhancedPath();

const CONFIG = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '127.0.0.1',
  maxSessions: 16,
  fileCountRatio: 20,
  autoRunClaude: process.env.AUTO_RUN_CLAUDE !== 'false',
  shell: DETECTED_SHELL,
  shellArgs: getShellArgs(),
  lineBufferFlushMs: 100,
  heartbeatIntervalMs: 30_000,
  ringBufferCapacity: 1000,
  ptyDefaultCols: 120,
  ptyDefaultRows: 40,
  autoRunDelayMs: 300,
  enhancedPath: _enhancedPath,
  agentCommands: {
    claude: `${resolveCommand('claude')} --enable-auto-mode`,
    codex: `${resolveCommand('codex')} --yolo`,
  },
  fileWatchDebounceMs: 500,
  fileTreeMaxDepth: 10,
  shutdownTimeoutMs: 5000,
  rawBufferMaxBytes: 100_000, // 100KB cap for raw terminal replay buffer
};

// Directories/files to exclude from file watching and tree building
const EXCLUDED_DIRS = new Set([
  '.git', 'node_modules', 'vendor', '__pycache__', '.venv', 'venv',
  '.tox', '.mypy_cache', '.pytest_cache', 'dist', 'build', '.next',
  '.nuxt', 'coverage', '.DS_Store', 'Thumbs.db',
]);

function shouldExclude(name) {
  if (EXCLUDED_DIRS.has(name)) return true;
  // Exclude hidden files/dirs except .claude
  if (name.startsWith('.') && name !== '.claude') return true;
  return false;
}

// ─── Security Helpers: Auth, Audit, Path Safety ─────────────────────────────

const AUTH_DIR = resolveProjectPath(process.env.CLAUDE_PUNK_AUTH_DIR, path.join(os.homedir(), '.claude-punk'));
const AUTH_FILE = path.join(AUTH_DIR, 'auth.json');
const AUDIT_FILE = path.join(AUTH_DIR, 'audit.log');
const ROLE_RANK = Object.freeze({ viewer: 1, operator: 2, admin: 3 });
const VALID_ROLES = new Set(Object.keys(ROLE_RANK));
const TOKEN_HASH_PARAMS = Object.freeze({ N: 16384, r: 8, p: 1, keyLength: 64, maxmem: 64 * 1024 * 1024 });
const FILE_TRANSFER_MAX_BYTES = 5 * 1024 * 1024;
const BROWSER_SESSION_COOKIE = 'claude_punk_session';
const BROWSER_SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const BROWSER_SESSION_MAX_AGE_SECONDS = Math.floor(BROWSER_SESSION_MAX_AGE_MS / 1000);

class AuthError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
    this.status = code === 'AUTH_FORBIDDEN' ? 403 : 401;
  }
}

class PathSafetyError extends Error {
  constructor(message = 'Path traversal not allowed') {
    super(message);
    this.code = 'PATH_OUTSIDE_WORKDIR';
  }
}

function hasRole(auth, minimumRole) {
  return ROLE_RANK[auth?.role] >= ROLE_RANK[minimumRole];
}

function sanitizeTokenRecord(record) {
  return {
    id: record.id,
    name: record.name,
    role: record.role,
    createdAt: record.createdAt,
    lastUsedAt: record.lastUsedAt || null,
    revokedAt: record.revokedAt || null,
  };
}

function createPlainToken() {
  return `cp_${crypto.randomBytes(32).toString('base64url')}`;
}

function createTokenId() {
  return `tok_${crypto.randomBytes(12).toString('base64url')}`;
}

function hashToken(plainToken) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(plainToken, salt, TOKEN_HASH_PARAMS.keyLength, {
    N: TOKEN_HASH_PARAMS.N,
    r: TOKEN_HASH_PARAMS.r,
    p: TOKEN_HASH_PARAMS.p,
    maxmem: TOKEN_HASH_PARAMS.maxmem,
  });
  return [
    'scrypt',
    TOKEN_HASH_PARAMS.N,
    TOKEN_HASH_PARAMS.r,
    TOKEN_HASH_PARAMS.p,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$');
}

function verifyTokenHash(plainToken, storedHash) {
  const parts = storedHash.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nRaw, rRaw, pRaw, saltRaw, keyRaw] = parts;
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  const salt = Buffer.from(saltRaw, 'base64url');
  const expected = Buffer.from(keyRaw, 'base64url');
  if (expected.length === 0) return false;
  const actual = crypto.scryptSync(plainToken, salt, expected.length, {
    N,
    r,
    p,
    maxmem: TOKEN_HASH_PARAMS.maxmem,
  });
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function timingSafeStringEqual(left, right) {
  const leftDigest = crypto.createHash('sha256').update(String(left)).digest();
  const rightDigest = crypto.createHash('sha256').update(String(right)).digest();
  return crypto.timingSafeEqual(leftDigest, rightDigest);
}

function tokenDigestId(prefix, plainToken) {
  return `${prefix}_${crypto.createHash('sha256').update(String(plainToken)).digest('base64url').slice(0, 18)}`;
}

async function ensurePrivateDir(dirPath) {
  await fs.promises.mkdir(dirPath, { recursive: true, mode: 0o700 });
  try {
    await fs.promises.chmod(dirPath, 0o700);
  } catch {
    // Windows and some filesystems do not fully support POSIX modes.
  }
}

async function writeJsonPrivate(filePath, data) {
  await ensurePrivateDir(path.dirname(filePath));
  const tmpPath = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  await fs.promises.writeFile(tmpPath, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  try {
    await fs.promises.chmod(tmpPath, 0o600);
  } catch { /* ignore unsupported chmod */ }
  await fs.promises.rename(tmpPath, filePath);
  try {
    await fs.promises.chmod(filePath, 0o600);
  } catch { /* ignore unsupported chmod */ }
}

function sanitizeAuditValue(value) {
  if (Array.isArray(value)) return value.map(sanitizeAuditValue);
  if (!value || typeof value !== 'object') return value;

  const sanitized = {};
  for (const [key, entryValue] of Object.entries(value)) {
    const lowered = key.toLowerCase();
    if (lowered.includes('token') && key !== 'tokenId') continue;
    if (['authorization', 'hash', 'content', 'data'].includes(lowered)) continue;
    sanitized[key] = sanitizeAuditValue(entryValue);
  }
  return sanitized;
}

class AuditLogger {
  constructor(filePath = AUDIT_FILE) {
    this.filePath = filePath;
  }

  async write(event) {
    try {
      await ensurePrivateDir(path.dirname(this.filePath));
      const line = JSON.stringify(sanitizeAuditValue({
        timestamp: new Date().toISOString(),
        ...event,
      })) + '\n';
      await fs.promises.appendFile(this.filePath, line, { mode: 0o600 });
      try {
        await fs.promises.chmod(this.filePath, 0o600);
      } catch { /* ignore unsupported chmod */ }
    } catch (err) {
      console.error(`[audit] Failed to write audit event: ${err.message}`);
    }
  }
}

class EnvTokenProvider {
  constructor(pathsToRead = dotenvPaths()) {
    this.pathsToRead = pathsToRead;
    this.signature = null;
    this.records = [];
  }

  async reloadIfNeeded() {
    const signature = await this.currentSignature();
    if (signature === this.signature) return;
    this.signature = signature;
    const values = await this.readValues();
    const token = this.firstToken(values);
    this.records = token ? [this.createRecord(token)] : [];
  }

  async currentSignature() {
    const parts = [];
    for (const envPath of this.pathsToRead) {
      try {
        const stat = await fs.promises.stat(envPath);
        parts.push(`${envPath}:${stat.mtimeMs}:${stat.size}`);
      } catch (err) {
        if (err.code !== 'ENOENT') parts.push(`${envPath}:error:${err.code}`);
        else parts.push(`${envPath}:missing`);
      }
    }
    for (const key of AUTH_ENV_KEYS) {
      if (process.env[key]) {
        parts.push(`${key}:${crypto.createHash('sha256').update(process.env[key]).digest('base64url')}`);
      }
    }
    return parts.join('|');
  }

  async readValues() {
    const values = {};
    for (const envPath of this.pathsToRead) {
      try {
        Object.assign(values, parseDotenvContent(await fs.promises.readFile(envPath, 'utf8')));
      } catch (err) {
        if (err.code !== 'ENOENT') console.warn(`[auth] Could not read ${envPath}: ${err.message}`);
      }
    }
    for (const key of AUTH_ENV_KEYS) {
      if (process.env[key] && !values[key]) values[key] = process.env[key];
    }
    return values;
  }

  firstToken(values) {
    for (const key of AUTH_ENV_KEYS) {
      const value = String(values[key] || '').trim();
      if (value) return value;
    }
    return null;
  }

  createRecord(plainToken) {
    const now = new Date().toISOString();
    return {
      id: tokenDigestId('env_admin', plainToken),
      name: 'env-admin',
      role: 'admin',
      createdAt: now,
      lastUsedAt: null,
      revokedAt: null,
      plainToken,
      source: 'env',
    };
  }

  async verify(plainToken) {
    await this.reloadIfNeeded();
    for (const record of this.records) {
      if (timingSafeStringEqual(plainToken, record.plainToken)) {
        record.lastUsedAt = new Date().toISOString();
        return sanitizeTokenRecord(record);
      }
    }
    return null;
  }

  async getActiveById(id) {
    await this.reloadIfNeeded();
    return this.records.find((record) => record.id === id) || null;
  }

  async list() {
    await this.reloadIfNeeded();
    return this.records.map(sanitizeTokenRecord);
  }

  async hasToken() {
    await this.reloadIfNeeded();
    return this.records.length > 0;
  }
}

class TokenStore {
  constructor(filePath = AUTH_FILE, envTokenProvider = new EnvTokenProvider()) {
    this.filePath = filePath;
    this.envTokenProvider = envTokenProvider;
    this.store = { version: 1, browserSessionSecret: null, tokens: [] };
    this._saveQueue = Promise.resolve();
  }

  async init(auditLogger = null) {
    await ensurePrivateDir(path.dirname(this.filePath));
    await this.load();
    if (this.store.tokens.length === 0 && !(await this.envTokenProvider.hasToken())) {
      const created = await this.createToken({ name: 'initial-admin', role: 'admin' });
      await auditLogger?.write({
        operation: 'token.create',
        actor: { type: 'system' },
        target: { tokenId: created.record.id, name: created.record.name, role: created.record.role },
        outcome: 'success',
      });
      console.log('[auth] Created initial admin token. Plaintext is shown once:');
      console.log(`[auth] Initial admin token: ${created.token}`);
    }
  }

  async load() {
    try {
      const raw = await fs.promises.readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      this.store = this.normalizeStore(parsed);
      if (!this.store.browserSessionSecret) {
        this.store.browserSessionSecret = crypto.randomBytes(32).toString('base64url');
        await this.save();
      }
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      this.store = this.normalizeStore();
      this.store.browserSessionSecret = crypto.randomBytes(32).toString('base64url');
      await this.save();
    }
  }

  normalizeStore(parsed = {}) {
    return {
      version: 1,
      browserSessionSecret: typeof parsed.browserSessionSecret === 'string'
        ? parsed.browserSessionSecret
        : null,
      tokens: Array.isArray(parsed.tokens) ? parsed.tokens : [],
    };
  }

  async save() {
    const write = () => writeJsonPrivate(this.filePath, this.store);
    this._saveQueue = this._saveQueue.then(write, write);
    await this._saveQueue;
  }

  async createToken({ name, role }) {
    const normalizedRole = role || 'operator';
    if (!VALID_ROLES.has(normalizedRole)) {
      const err = new Error(`Invalid role: ${normalizedRole}`);
      err.code = 'INVALID_ROLE';
      throw err;
    }
    const now = new Date().toISOString();
    const token = createPlainToken();
    const record = {
      id: createTokenId(),
      name: String(name || normalizedRole).slice(0, 120),
      hash: hashToken(token),
      role: normalizedRole,
      createdAt: now,
      lastUsedAt: null,
      revokedAt: null,
    };
    this.store.tokens.push(record);
    await this.save();
    return { token, record: sanitizeTokenRecord(record) };
  }

  async verify(plainToken) {
    if (!plainToken) return null;
    const envIdentity = await this.envTokenProvider.verify(plainToken);
    if (envIdentity) return envIdentity;

    for (const record of this.store.tokens) {
      if (record.revokedAt) continue;
      let matched = false;
      try {
        matched = verifyTokenHash(plainToken, record.hash);
      } catch {
        matched = false;
      }
      if (matched) {
        record.lastUsedAt = new Date().toISOString();
        await this.save();
        return sanitizeTokenRecord(record);
      }
    }
    return null;
  }

  async getActiveById(id) {
    const envRecord = await this.envTokenProvider.getActiveById(id);
    if (envRecord) return envRecord;
    return this.store.tokens.find((record) => record.id === id && !record.revokedAt) || null;
  }

  async createBrowserSession(auth) {
    const record = await this.getActiveById(auth?.id);
    if (!record) return null;
    const now = Date.now();
    const payload = {
      v: 1,
      tokenId: record.id,
      role: record.role,
      iat: now,
      exp: now + BROWSER_SESSION_MAX_AGE_MS,
    };
    return this.signBrowserSession(payload);
  }

  signBrowserSession(payload) {
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto
      .createHmac('sha256', this.store.browserSessionSecret)
      .update(encodedPayload)
      .digest('base64url');
    return `${encodedPayload}.${signature}`;
  }

  async verifyBrowserSession(sessionValue) {
    if (!sessionValue || !this.store.browserSessionSecret) return null;
    try {
      const [encodedPayload, signature, extra] = String(sessionValue).split('.');
      if (!encodedPayload || !signature || extra !== undefined) return null;
      const expected = crypto
        .createHmac('sha256', this.store.browserSessionSecret)
        .update(encodedPayload)
        .digest();
      const actual = Buffer.from(signature, 'base64url');
      if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;

      const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
      if (payload?.v !== 1 || typeof payload.tokenId !== 'string' || typeof payload.exp !== 'number') {
        return null;
      }
      if (payload.exp < Date.now()) return null;

      const record = await this.getActiveById(payload.tokenId);
      if (!record || record.role !== payload.role) return null;
      if (record.source !== 'env') {
        record.lastUsedAt = new Date().toISOString();
        await this.save();
      }
      return sanitizeTokenRecord(record);
    } catch {
      return null;
    }
  }

  async list() {
    return [
      ...(await this.envTokenProvider.list()),
      ...this.store.tokens.map(sanitizeTokenRecord),
    ];
  }

  async revoke(id) {
    const record = this.store.tokens.find((token) => token.id === id);
    if (!record || record.revokedAt) return null;
    record.revokedAt = new Date().toISOString();
    await this.save();
    return sanitizeTokenRecord(record);
  }
}

function parseBearerToken(req, { allowQueryToken = false } = {}) {
  const value = req.headers?.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(value);
  if (match?.[1]) return match[1].trim();

  if (allowQueryToken) {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const token = url.searchParams.get('token');
      if (token) return token;
    } catch {
      // Treat malformed URLs as missing auth.
    }
  }

  return null;
}

function parseCookies(cookieHeader) {
  const cookies = new Map();
  for (const part of String(cookieHeader || '').split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    const rawValue = part.slice(index + 1).trim();
    if (!name) continue;
    try {
      cookies.set(name, decodeURIComponent(rawValue));
    } catch {
      cookies.set(name, rawValue);
    }
  }
  return cookies;
}

function parseBrowserSessionCookie(req) {
  return parseCookies(req.headers?.cookie).get(BROWSER_SESSION_COOKIE) || null;
}

function normalizeHost(value) {
  return String(value || '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/^::ffff:/, '');
}

function isLocalhost(value) {
  const host = normalizeHost(value);
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function requestHostName(req) {
  try {
    return new URL(`http://${req.headers.host || ''}`).hostname;
  } catch {
    return req.headers.host || '';
  }
}

function allowsLocalhostQueryToken(req) {
  return isLocalhost(CONFIG.host) && isLocalhost(req.socket?.remoteAddress) && isLocalhost(requestHostName(req));
}

function configuredAllowedOrigins() {
  return new Set(String(process.env.CLAUDE_PUNK_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean));
}

const ALLOWED_ORIGINS = configuredAllowedOrigins();

function originHostMatchesRequest(req, originUrl) {
  const requestHost = String(req.headers.host || '').trim().toLowerCase();
  return Boolean(requestHost) && originUrl.host.toLowerCase() === requestHost;
}

function isAllowedOrigin(origin, req = null) {
  if (!origin) return true;
  try {
    const originUrl = new URL(origin);
    if (isLocalhost(originUrl.hostname)) return true;
    if (ALLOWED_ORIGINS.has(originUrl.origin)) return true;
    if (req && originHostMatchesRequest(req, originUrl)) return true;
  } catch {
    return false;
  }
  return false;
}

function isAllowedRequestOrigin(req) {
  return isAllowedOrigin(req.headers.origin, req);
}

function isBrowserSessionRequest(req) {
  return Boolean(parseBrowserSessionCookie(req));
}

function rejectDisallowedBrowserOrigin(req, res, next) {
  if (req.headers.origin && isBrowserSessionRequest(req) && !isAllowedRequestOrigin(req)) {
    return res.status(403).json({ error: 'AUTH_FORBIDDEN' });
  }
  next();
}

function isSecureRequest(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  return Boolean(req.secure || forwardedProto === 'https');
}

function browserCookieSameSite(req) {
  const requested = String(process.env.CLAUDE_PUNK_COOKIE_SAMESITE || 'lax').trim().toLowerCase();
  const normalized = requested === 'strict' ? 'Strict'
    : requested === 'none' ? 'None'
    : 'Lax';
  return normalized === 'None' && !isSecureRequest(req) ? 'Lax' : normalized;
}

function buildBrowserSessionCookie(req, value, maxAgeSeconds) {
  const parts = [
    `${BROWSER_SESSION_COOKIE}=${encodeURIComponent(value)}`,
    'HttpOnly',
    'Path=/',
    `Max-Age=${maxAgeSeconds}`,
    `SameSite=${browserCookieSameSite(req)}`,
  ];
  if (maxAgeSeconds <= 0) parts.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  if (isSecureRequest(req)) parts.push('Secure');
  return parts.join('; ');
}

function setBrowserSessionCookie(req, res, value) {
  res.setHeader('Set-Cookie', buildBrowserSessionCookie(req, value, BROWSER_SESSION_MAX_AGE_SECONDS));
}

function clearBrowserSessionCookie(req, res) {
  res.setHeader('Set-Cookie', buildBrowserSessionCookie(req, '', 0));
}

async function authenticateRequest(req, tokenStore, options = {}) {
  const plainToken = parseBearerToken(req, options);
  if (plainToken) {
    const identity = await tokenStore.verify(plainToken);
    if (!identity) throw new AuthError('AUTH_INVALID');
    return identity;
  }

  const browserSession = parseBrowserSessionCookie(req);
  if (browserSession) {
    const identity = await tokenStore.verifyBrowserSession(browserSession);
    if (!identity) throw new AuthError('AUTH_INVALID');
    return identity;
  }

  throw new AuthError('AUTH_REQUIRED');
}

function requireAuth(tokenStore) {
  return async (req, res, next) => {
    try {
      req.auth = await authenticateRequest(req, tokenStore);
      next();
    } catch (err) {
      const code = err instanceof AuthError ? err.code : 'AUTH_INVALID';
      const status = err instanceof AuthError ? err.status : 401;
      res.status(status).json({ error: code });
    }
  };
}

function requireMinimumRole(minimumRole) {
  return (req, res, next) => {
    if (!hasRole(req.auth, minimumRole)) {
      return res.status(403).json({ error: 'AUTH_FORBIDDEN' });
    }
    next();
  };
}

function auditActor(auth) {
  if (!auth) return { type: 'unknown' };
  return { tokenId: auth.id, role: auth.role };
}

function isInsidePath(rootDir, targetPath) {
  const relative = path.relative(rootDir, targetPath);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function assertInsidePath(rootDir, targetPath) {
  if (!isInsidePath(rootDir, targetPath)) {
    throw new PathSafetyError();
  }
}

async function resolveExistingInside(rootDir, targetPath) {
  const root = await fs.promises.realpath(rootDir);
  const requestedPath = path.resolve(root, targetPath);
  assertInsidePath(root, requestedPath);
  const realPath = await fs.promises.realpath(requestedPath);
  assertInsidePath(root, realPath);
  return { root, requestedPath, realPath };
}

async function resolveNewInside(rootDir, targetPath) {
  const root = await fs.promises.realpath(rootDir);
  const requestedPath = path.resolve(root, targetPath);
  assertInsidePath(root, requestedPath);

  const targetParent = path.dirname(requestedPath);
  const targetName = path.basename(requestedPath);
  const missingParentParts = [];
  let cursor = targetParent;
  let realParent = null;

  while (true) {
    try {
      realParent = await fs.promises.realpath(cursor);
      break;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      const next = path.dirname(cursor);
      if (next === cursor) throw new PathSafetyError();
      missingParentParts.push(path.basename(cursor));
      cursor = next;
    }
  }

  assertInsidePath(root, realParent);
  const finalPath = path.join(realParent, ...missingParentParts.reverse(), targetName);
  assertInsidePath(root, finalPath);
  return { root, requestedPath, realPath: finalPath };
}

async function resolveWritableInside(rootDir, targetPath) {
  const root = await fs.promises.realpath(rootDir);
  const requestedPath = path.resolve(root, targetPath);
  try {
    const realPath = await fs.promises.realpath(requestedPath);
    assertInsidePath(root, realPath);
    return { root, requestedPath, realPath };
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    return resolveNewInside(root, targetPath);
  }
}

function sendPathError(sendToClient, ws) {
  sendToClient(ws, 'error', { message: 'Path traversal not allowed', code: 'INVALID_MESSAGE' });
}

// ─── Claude Activity Helpers ────────────────────────────────────────────────

function encodeProjectPath(workDir) {
  return workDir.replace(/\//g, '-');
}

function getClaudeProjectDir(workDir) {
  return path.join(os.homedir(), '.claude', 'projects', encodeProjectPath(workDir));
}

/**
 * List Claude Code conversations for a given workDir.
 * Reads JSONL files from ~/.claude/projects/<encoded>/ and extracts metadata.
 */
async function listClaudeConversations(workDir) {
  const projectDir = getClaudeProjectDir(workDir);
  let files;
  try {
    const entries = await fs.promises.readdir(projectDir);
    files = entries.filter(f => f.endsWith('.jsonl'));
  } catch {
    return [];
  }

  const conversations = [];

  for (const file of files) {
    const filePath = path.join(projectDir, file);
    const sessionId = file.replace('.jsonl', '');

    try {
      const stat = await fs.promises.stat(filePath);
      if (stat.size === 0) continue;

      // Read first 8KB for first user message, and last 4KB for last timestamp
      const fd = await fs.promises.open(filePath, 'r');
      try {
        // Read head
        const headSize = Math.min(stat.size, 8192);
        const headBuf = Buffer.alloc(headSize);
        await fd.read(headBuf, 0, headSize, 0);
        const headText = headBuf.toString('utf-8');

        // Read tail
        const tailSize = Math.min(stat.size, 4096);
        const tailBuf = Buffer.alloc(tailSize);
        await fd.read(tailBuf, 0, tailSize, stat.size - tailSize);
        const tailText = tailBuf.toString('utf-8');

        await fd.close();

        // Extract first user message
        let firstUserText = '';
        let createdAt = '';
        for (const line of headText.split('\n')) {
          if (!line) continue;
          try {
            const entry = JSON.parse(line);
            if (!createdAt && entry.timestamp) createdAt = entry.timestamp;
            if (entry.type === 'user' && entry.message) {
              const content = entry.message.content;
              if (typeof content === 'string') {
                if (!content.startsWith('<')) firstUserText = content.slice(0, 200);
              } else if (Array.isArray(content)) {
                for (const b of content) {
                  if (b.type === 'text' && b.text && !b.text.startsWith('<')) {
                    firstUserText = b.text.slice(0, 200);
                    break;
                  }
                }
              }
              if (firstUserText) break;
            }
          } catch { /* skip malformed */ }
        }

        // Extract last timestamp from tail
        let lastActiveAt = '';
        const tailLines = tailText.split('\n').filter(Boolean);
        for (let i = tailLines.length - 1; i >= 0; i--) {
          try {
            const entry = JSON.parse(tailLines[i]);
            if (entry.timestamp) { lastActiveAt = entry.timestamp; break; }
          } catch { /* skip partial line */ }
        }

        conversations.push({
          sessionId,
          firstUserText: firstUserText || '(no message)',
          createdAt: createdAt || stat.birthtime.toISOString(),
          lastActiveAt: lastActiveAt || stat.mtime.toISOString(),
          sizeBytes: stat.size,
        });
      } catch {
        await fd.close().catch(() => {});
      }
    } catch { /* skip unreadable files */ }
  }

  // Sort by lastActiveAt descending (most recent first)
  conversations.sort((a, b) => new Date(b.lastActiveAt) - new Date(a.lastActiveAt));

  // Return top 30
  return conversations.slice(0, 30);
}

// ─── Section 2: RingBuffer ───────────────────────────────────────────────────

class RingBuffer {
  constructor(capacity = CONFIG.ringBufferCapacity) {
    this.capacity = capacity;
    this.buffer = new Array(capacity);
    this.head = 0;
    this.size = 0;
  }

  write(item) {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) this.size++;
  }

  readAll() {
    if (this.size === 0) return [];
    const result = new Array(this.size);
    const start = (this.head - this.size + this.capacity) % this.capacity;
    for (let i = 0; i < this.size; i++) {
      result[i] = this.buffer[(start + i) % this.capacity];
    }
    return result;
  }
}

// ─── Section 2b: RawReplayBuffer ─────────────────────────────────────────────

/** Capped string buffer that keeps the most recent N bytes of raw PTY output. */
class RawReplayBuffer {
  constructor(maxBytes = CONFIG.rawBufferMaxBytes) {
    this.maxBytes = maxBytes;
    this.chunks = [];
    this.totalBytes = 0;
  }

  write(data) {
    const len = Buffer.byteLength(data, 'utf8');
    this.chunks.push(data);
    this.totalBytes += len;
    // Evict oldest chunks until under cap
    while (this.totalBytes > this.maxBytes && this.chunks.length > 1) {
      const removed = this.chunks.shift();
      this.totalBytes -= Buffer.byteLength(removed, 'utf8');
    }
  }

  /** Return all stored output as a single string. */
  read() {
    return this.chunks.join('');
  }
}

// ─── Section 3: LineBuffer ───────────────────────────────────────────────────

class LineBuffer {
  /**
   * Buffers raw PTY chunks and emits clean lines via callback.
   * @param {(stream: string, line: string) => void} onLine
   */
  constructor(onLine) {
    this.onLine = onLine;
    this.rawPartials = new Map(); // stream -> raw (unprocessed) partial string
    this.timers = new Map();     // stream -> timeout id
  }

  /**
   * Strip ANSI sequences that are not useful for display.
   * Keep SGR (color) sequences (\x1b[...m) since the frontend parses them.
   * Remove cursor movement, erase, OSC, and other control sequences.
   */
  static stripNonSGR(str) {
    // 1. Remove OSC sequences: ESC ] ... BEL  or  ESC ] ... ESC \
    str = str.replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, '');
    // 2. Remove non-SGR CSI sequences (keep \x1b[...m, remove \x1b[...X where X != m)
    str = str.replace(/\x1b\[[\x30-\x3f]*[\x20-\x2f]*[A-LN-Za-ln-z]/g, '');
    // 3. Remove single-char escape sequences (ESC + single char that's not '[' or ']')
    str = str.replace(/\x1b[^[\]]/g, '');
    return str;
  }

  /**
   * Handle carriage returns: for each segment between \n, take text after the
   * last \r. This handles spinners/progress bars that overwrite the same line.
   */
  static handleCR(str) {
    const segments = str.split('\n');
    for (let i = 0; i < segments.length; i++) {
      const crIdx = segments[i].lastIndexOf('\r');
      if (crIdx !== -1) {
        segments[i] = segments[i].slice(crIdx + 1);
      }
    }
    return segments.join('\n');
  }

  feed(stream, rawChunk) {
    // Clear any pending flush timer for this stream
    const existingTimer = this.timers.get(stream);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.timers.delete(stream);
    }

    // Combine with any stored raw partial
    const existing = this.rawPartials.get(stream) || '';
    const combined = existing + rawChunk;

    // Split on newlines in the raw data first
    const rawLines = combined.split('\n');
    // Last element is the raw partial (may be empty if chunk ended with \n)
    const rawPartial = rawLines.pop();

    // Clean and emit each complete line
    for (const rawLine of rawLines) {
      // Strip trailing \r (part of PTY's \r\n line ending) before CR handling,
      // so it isn't mistaken for a line-overwrite indicator.
      const trimmed = rawLine.replace(/\r$/, '');
      const cleaned = LineBuffer.handleCR(LineBuffer.stripNonSGR(trimmed));
      if (cleaned.length > 0) {
        this.onLine(stream, cleaned);
      }
    }

    // Store raw partial for next chunk
    if (rawPartial && rawPartial.length > 0) {
      this.rawPartials.set(stream, rawPartial);
      // Set flush timer — emit partial after silence period
      const timer = setTimeout(() => {
        this.timers.delete(stream);
        const remaining = this.rawPartials.get(stream);
        if (remaining && remaining.length > 0) {
          this.rawPartials.set(stream, '');
          const trimmed = remaining.replace(/\r$/, '');
          const cleaned = LineBuffer.handleCR(LineBuffer.stripNonSGR(trimmed));
          if (cleaned.length > 0) {
            this.onLine(stream, cleaned);
          }
        }
      }, CONFIG.lineBufferFlushMs);
      this.timers.set(stream, timer);
    } else {
      this.rawPartials.set(stream, '');
    }
  }

  flush(stream) {
    const timer = this.timers.get(stream);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(stream);
    }
    const remaining = this.rawPartials.get(stream);
    if (remaining && remaining.length > 0) {
      this.rawPartials.set(stream, '');
      const trimmed = remaining.replace(/\r$/, '');
      const cleaned = LineBuffer.handleCR(LineBuffer.stripNonSGR(trimmed));
      if (cleaned.length > 0) {
        this.onLine(stream, cleaned);
      }
    }
  }

  destroy() {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.rawPartials.clear();
  }
}

// ─── Section 4: SessionManager ───────────────────────────────────────────────

class SessionManager extends EventEmitter {
  constructor() {
    super();
    this.sessions = new Map();
  }

  create(workDir, label, agentType = 'claude', resume = false) {
    console.log(`[session] Creating session: workDir="${workDir}", label="${label}", agentType="${agentType}", resume=${resume}`);

    // Validate
    if (!workDir) throw new Error('workDir is required');
    if (!fs.existsSync(workDir)) {
      console.error(`[session] workDir does not exist: "${workDir}"`);
      throw new Error(`workDir does not exist: ${workDir}`);
    }
    if (!fs.statSync(workDir).isDirectory()) {
      console.error(`[session] workDir is not a directory: "${workDir}"`);
      throw new Error(`workDir is not a directory: ${workDir}`);
    }
    workDir = fs.realpathSync(workDir);
    if (this.sessions.size >= CONFIG.maxSessions) {
      throw new Error(`Maximum sessions (${CONFIG.maxSessions}) reached`);
    }
    if (!CONFIG.agentCommands[agentType]) {
      console.error(`[session] Unknown agentType: "${agentType}", available: ${Object.keys(CONFIG.agentCommands).join(', ')}`);
      throw new Error(`Unknown agentType: ${agentType}`);
    }

    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    // Spawn PTY
    console.log(`[session] Spawning PTY: shell="${CONFIG.shell}", args=${JSON.stringify(CONFIG.shellArgs)}, cwd="${workDir}"`);
    let proc;
    try {
      proc = pty.spawn(CONFIG.shell, CONFIG.shellArgs, {
        name: 'xterm-256color',
        cwd: workDir,
        cols: CONFIG.ptyDefaultCols,
        rows: CONFIG.ptyDefaultRows,
        env: { ...process.env, TERM: 'xterm-256color', PATH: CONFIG.enhancedPath },
      });
      console.log(`[session] PTY spawned successfully (pid=${proc.pid})`);
    } catch (spawnErr) {
      console.error(`[session] PTY spawn FAILED: ${spawnErr.message}`);
      console.error(`[session]   shell: ${CONFIG.shell}`);
      console.error(`[session]   args: ${JSON.stringify(CONFIG.shellArgs)}`);
      console.error(`[session]   cwd: ${workDir}`);
      console.error(`[session]   platform: ${process.platform}`);
      throw new Error(`Failed to spawn terminal: ${spawnErr.message}`);
    }

    const ringBuffer = new RingBuffer();
    const rawReplayBuffer = new RawReplayBuffer();

    const lineBuffer = new LineBuffer((stream, line) => {
      const outputMsg = { sessionId: id, stream, data: line, timestamp: new Date().toISOString() };
      ringBuffer.write(outputMsg);
      this.emit('session-output', outputMsg);
    });

    // node-pty merges stdout+stderr into single stream
    proc.onData((data) => {
      lineBuffer.feed('stdout', data);
      rawReplayBuffer.write(data);
      // Also emit raw data for xterm.js rendering
      this.emit('terminal-output', { sessionId: id, data });
    });

    proc.onExit(({ exitCode }) => {
      console.log(`[session] PTY exited: session=${id}, exitCode=${exitCode}`);
      lineBuffer.flush('stdout');
      lineBuffer.destroy();

      const session = this.sessions.get(id);
      if (session) {
        session.state = 'terminated';
        session.exitCode = exitCode;
        if (session._forceKillTimer) {
          clearTimeout(session._forceKillTimer);
          session._forceKillTimer = null;
        }
      }

      this.emit('session-exit', { sessionId: id, exitCode });

      // Clean up terminated session from memory after a short delay
      // (allows the exit event to propagate to WS clients first)
      setTimeout(() => {
        this.sessions.delete(id);
      }, 5000);
    });

    const session = {
      id,
      state: 'active',
      workDir,
      label: label || path.basename(workDir),
      agentType,
      createdAt,
      proc,
      ringBuffer,
      rawReplayBuffer,
      lineBuffer,
      exitCode: null,
      cols: CONFIG.ptyDefaultCols,
      rows: CONFIG.ptyDefaultRows,
    };

    this.sessions.set(id, session);

    // Auto-run agent after a short delay (lets shell init complete)
    if (CONFIG.autoRunClaude) {
      setTimeout(() => {
        if (session.state === 'active') {
          let cmd = CONFIG.agentCommands[agentType];
          if (resume) cmd += typeof resume === 'string' ? ` --resume ${resume}` : ' --resume';
          console.log(`[session] Auto-running agent command: "${cmd}" (session=${id})`);
          proc.write(cmd + '\n');
        } else {
          console.warn(`[session] Skipping auto-run — session ${id} already ${session.state}`);
        }
      }, CONFIG.autoRunDelayMs);
    }

    return this.toPublic(session);
  }

  sendPrompt(id, prompt) {
    const session = this.getSession(id);
    session.proc.write(prompt + '\n');
  }

  writeRaw(id, data) {
    const session = this.getSession(id);
    session.proc.write(data);
  }

  resize(id, cols, rows) {
    const session = this.getSession(id);
    session.proc.resize(cols, rows);
    session.cols = cols;
    session.rows = rows;
  }

  kill(id) {
    const session = this.sessions.get(id);
    if (!session) return;
    if (session.state === 'terminated') return;

    console.log(`[session] Killing session ${id} (pid=${session.proc.pid}, platform=${process.platform})`);
    session.state = 'terminated';

    // Graceful kill
    // NOTE: On Windows, never call session.proc.kill() directly — node-pty's
    // windowsPtyAgent crashes with "Cannot read properties of undefined (reading
    // 'forEach')" when the process is already dead. Always use taskkill instead.
    try {
      if (IS_WINDOWS) {
        execSync(`taskkill /PID ${session.proc.pid} /T`, { timeout: 2000 });
      } else {
        session.proc.kill('SIGTERM');
      }
    } catch (err) {
      console.warn(`[session] Graceful kill failed for ${id}: ${err.message}`);
    }

    // Force kill after 3s
    session._forceKillTimer = setTimeout(() => {
      session._forceKillTimer = null;
      try {
        if (IS_WINDOWS) {
          execSync(`taskkill /PID ${session.proc.pid} /F /T`, { timeout: 2000 });
        } else {
          session.proc.kill('SIGKILL');
        }
        console.log(`[session] Force-killed session ${id}`);
      } catch (err) {
        console.warn(`[session] Force kill failed for ${id} (likely already dead): ${err.message}`);
      }
    }, 3000);
  }

  getSession(id) {
    const session = this.sessions.get(id);
    if (!session) throw new Error('SESSION_NOT_FOUND');
    if (session.state === 'terminated') throw new Error('SESSION_TERMINATED');
    return session;
  }

  getHistory(id) {
    const session = this.sessions.get(id);
    if (!session) return [];
    return session.ringBuffer.readAll();
  }

  getRawReplay(id) {
    const session = this.sessions.get(id);
    if (!session) return '';
    return session.rawReplayBuffer.read();
  }

  list() {
    return Array.from(this.sessions.values())
      .filter((s) => s.state !== 'terminated')
      .map((s) => this.toPublic(s));
  }

  /** Return all sessions including terminated ones (for debugging). */
  listAll() {
    return Array.from(this.sessions.values()).map((s) => this.toPublic(s));
  }

  /** Remove terminated sessions from memory. */
  pruneTerminated() {
    for (const [id, session] of this.sessions) {
      if (session.state === 'terminated') {
        this.sessions.delete(id);
      }
    }
  }

  get(id) {
    const session = this.sessions.get(id);
    if (!session) return null;
    return this.toPublic(session);
  }

  toPublic(session) {
    return {
      id: session.id,
      state: session.state,
      workDir: session.workDir,
      label: session.label,
      agentType: session.agentType,
      createdAt: session.createdAt,
    };
  }

  killAll() {
    for (const [id, session] of this.sessions) {
      if (session.state !== 'terminated') {
        this.kill(id);
      }
    }
  }
}

// ─── Section 5: FileWatcher ──────────────────────────────────────────────────

class FileWatcher extends EventEmitter {
  constructor() {
    super();
    this.watchers = new Map(); // sessionId -> { watcher, workDir, debounceTimer }
    this.latestCounts = new Map(); // sessionId -> { fileCount, drinkCount }
  }

  watch(sessionId, workDir) {
    if (this.watchers.has(sessionId)) return;

    const watcher = chokidar.watch(workDir, {
      ignored: (filePath) => {
        const rel = path.relative(workDir, filePath);
        const parts = rel.split(path.sep);
        return parts.some((p) => shouldExclude(p));
      },
      persistent: true,
      ignoreInitial: false,
      depth: 99,
    });

    const entry = { watcher, workDir, debounceTimer: null };

    const debouncedUpdate = () => {
      if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
      entry.debounceTimer = setTimeout(async () => {
        try {
          const fileCount = await this.countFiles(workDir);
          const drinkCount = Math.floor(fileCount / CONFIG.fileCountRatio);
          this.latestCounts.set(sessionId, { fileCount, drinkCount });
          this.emit('files-update', { sessionId, fileCount, drinkCount });
        } catch (err) {
          console.error(`[FileWatcher] Error counting files for ${sessionId}:`, err.message);
        }
      }, CONFIG.fileWatchDebounceMs);
    };

    watcher.on('add', debouncedUpdate);
    watcher.on('unlink', debouncedUpdate);
    watcher.on('ready', debouncedUpdate);

    this.watchers.set(sessionId, entry);
  }

  async countFiles(dir) {
    let count = 0;
    const walk = async (d) => {
      let entries;
      try {
        entries = await fs.promises.readdir(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (shouldExclude(entry.name)) continue;
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (entry.isFile()) {
          count++;
        }
      }
    };
    await walk(dir);
    return count;
  }

  unwatch(sessionId) {
    const entry = this.watchers.get(sessionId);
    if (!entry) return;
    if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
    entry.watcher.close();
    this.watchers.delete(sessionId);
    this.latestCounts.delete(sessionId);
  }

  unwatchAll() {
    for (const sessionId of this.watchers.keys()) {
      this.unwatch(sessionId);
    }
  }
}

// ─── Section 5b: ClaudeActivityWatcher ───────────────────────────────────────

class ClaudeActivityWatcher extends EventEmitter {
  constructor() {
    super();
    // Deduplicated: one chokidar watcher per projectDir
    this.dirWatchers = new Map();  // projectDir → { watcher, fileStates, gameSessionIds: Set, fileOwners: Map<filePath, gameSessionId> }
    // Reverse lookup: gameSessionId → projectDir
    this.sessionDirs = new Map();
    this.debounceTimers = new Map(); // filePath → timer
  }

  watch(gameSessionId, workDir) {
    // If already watching this session, skip (but allow re-watch if previous attempt failed)
    if (this.sessionDirs.has(gameSessionId)) return;

    const projectDir = getClaudeProjectDir(workDir);

    // Check if directory exists
    try {
      fs.accessSync(projectDir);
    } catch {
      console.log(`[ClaudeActivity] Project dir not found (yet): ${projectDir} — deferring watch`);
      // Defer: check every 2s for up to 30s for the directory to appear
      if (!this._deferredWatches) this._deferredWatches = new Map();
      if (!this._deferredWatches.has(gameSessionId)) {
        let attempts = 0;
        const timer = setInterval(() => {
          attempts++;
          try {
            fs.accessSync(projectDir);
            clearInterval(timer);
            this._deferredWatches.delete(gameSessionId);
            console.log(`[ClaudeActivity] Deferred dir appeared: ${projectDir} (after ${attempts * 2}s)`);
            this.watch(gameSessionId, workDir);
          } catch {
            if (attempts >= 15) {
              clearInterval(timer);
              this._deferredWatches.delete(gameSessionId);
              console.log(`[ClaudeActivity] Gave up waiting for ${projectDir}`);
            }
          }
        }, 2000);
        this._deferredWatches.set(gameSessionId, timer);
      }
      return;
    }

    this.sessionDirs.set(gameSessionId, projectDir);

    // If this projectDir is already watched, just add this session
    if (this.dirWatchers.has(projectDir)) {
      const entry = this.dirWatchers.get(projectDir);
      entry.gameSessionIds.add(gameSessionId);
      console.log(`[ClaudeActivity] Added session ${gameSessionId} to existing watcher for ${projectDir}`);
      return;
    }

    console.log(`[ClaudeActivity] Watching ${projectDir} for session ${gameSessionId}`);

    const fileStates = new Map();   // filePath → { byteOffset, claudeSessionId }
    const fileOwners = new Map();   // filePath → gameSessionId (which session owns this JSONL)
    const gameSessionIds = new Set([gameSessionId]);

    const watcher = chokidar.watch(path.join(projectDir, '*.jsonl'), {
      persistent: true,
      ignoreInitial: false,
      depth: 0,
    });

    const watcherReady = { value: false };
    watcher.on('ready', () => { watcherReady.value = true; });

    watcher.on('add', (filePath) => {
      try {
        const stat = fs.statSync(filePath);
        const claudeSessionId = path.basename(filePath, '.jsonl');
        fileStates.set(filePath, { byteOffset: stat.size, claudeSessionId });

        if (!watcherReady.value) {
          // Existing file discovered during initial scan — track but don't assign
          console.log(`[ClaudeActivity] Tracking existing file: ${path.basename(filePath)} (${stat.size} bytes, unassigned)`);
          return;
        }

        // Truly new file created after watcher started — assign to most recent unassigned session
        console.log(`[ClaudeActivity] New file detected: ${path.basename(filePath)} (${stat.size} bytes)`);
        const ownedFiles = new Set(fileOwners.values());
        for (const sid of [...gameSessionIds].reverse()) {
          if (!ownedFiles.has(sid)) {
            fileOwners.set(filePath, sid);
            console.log(`[ClaudeActivity] Assigned ${path.basename(filePath)} → session ${sid}`);
            break;
          }
        }
      } catch {
        // file may have been removed already
      }
    });

    watcher.on('change', (filePath) => {
      if (!filePath.endsWith('.jsonl')) return;

      // Debounce reads per file (single read, then emit to owner)
      const existing = this.debounceTimers.get(filePath);
      if (existing) clearTimeout(existing);
      this.debounceTimers.set(filePath, setTimeout(() => {
        this.debounceTimers.delete(filePath);
        this._readNewLines(filePath, projectDir);
      }, 200));
    });

    this.dirWatchers.set(projectDir, { watcher, fileStates, gameSessionIds, fileOwners });
  }

  _readNewLines(filePath, projectDir) {
    const dirEntry = this.dirWatchers.get(projectDir);
    if (!dirEntry) return;

    const state = dirEntry.fileStates.get(filePath);
    if (!state) return;

    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return;
    }

    if (stat.size <= state.byteOffset) return;

    const bytesToRead = stat.size - state.byteOffset;
    const buf = Buffer.alloc(bytesToRead);

    let fd;
    try {
      fd = fs.openSync(filePath, 'r');
      fs.readSync(fd, buf, 0, bytesToRead, state.byteOffset);
      fs.closeSync(fd);
    } catch {
      if (fd !== undefined) try { fs.closeSync(fd); } catch { /* ignore */ }
      return;
    }

    state.byteOffset = stat.size;

    const lines = buf.toString('utf-8').split('\n').filter(Boolean);
    const events = [];

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        const parsed = this._parseEntry(entry);
        if (parsed.length > 0) events.push(...parsed);
      } catch {
        // skip malformed lines
      }
    }

    if (events.length === 0) return;

    // Determine which session owns this file
    const owner = dirEntry.fileOwners.get(filePath);
    if (owner) {
      // Emit only to the owning session
      this.emit('activity', { gameSessionId: owner, events });
    } else {
      // Unassigned file: try to assign now
      const ownedFiles = new Set(dirEntry.fileOwners.values());
      for (const sid of [...dirEntry.gameSessionIds].reverse()) {
        if (!ownedFiles.has(sid)) {
          dirEntry.fileOwners.set(filePath, sid);
          console.log(`[ClaudeActivity] Late-assigned ${path.basename(filePath)} → session ${sid}`);
          this.emit('activity', { gameSessionId: sid, events });
          return;
        }
      }
      // All sessions have files — drop events rather than broadcast to wrong sessions
      console.log(`[ClaudeActivity] Dropping events from unassigned file ${path.basename(filePath)} (all sessions already have files)`);
    }
  }

  _parseEntry(entry) {
    const results = [];
    const ts = entry.timestamp || new Date().toISOString();

    switch (entry.type) {
      case 'assistant': {
        const msg = entry.message;
        if (!msg || !msg.content) break;

        // Extract usage info
        const usage = msg.usage ? {
          inputTokens: msg.usage.input_tokens,
          outputTokens: msg.usage.output_tokens,
          cacheRead: msg.usage.cache_read_input_tokens,
          cacheCreation: msg.usage.cache_creation_input_tokens,
        } : undefined;

        for (const block of msg.content) {
          if (block.type === 'text' && block.text) {
            results.push({
              timestamp: ts,
              kind: 'assistant_text',
              text: block.text.slice(0, 500),
              usage,
            });
          } else if (block.type === 'tool_use') {
            const toolEvent = {
              timestamp: ts,
              kind: 'tool_use',
              toolName: block.name,
              toolId: block.id,
              input: this._summarizeToolInput(block.name, block.input),
            };
            // Tool-specific extra fields
            switch (block.name) {
              case 'ExitPlanMode':
                toolEvent.plan = (block.input?.plan || JSON.stringify(block.input || {})).slice(0, 20000);
                break;
              case 'AskUserQuestion':
                toolEvent.questions = block.input?.questions;
                break;
              case 'Task':
                toolEvent.subagentType = block.input?.subagent_type;
                toolEvent.agentName = block.input?.name;
                toolEvent.description = block.input?.description;
                break;
              case 'Skill':
                toolEvent.skill = block.input?.skill;
                toolEvent.args = block.input?.args;
                break;
              case 'TeamCreate':
                toolEvent.teamName = block.input?.team_name;
                toolEvent.teamDescription = block.input?.description;
                break;
              case 'SendMessage':
                toolEvent.recipient = block.input?.recipient;
                toolEvent.messageType = block.input?.type;
                break;
              case 'TaskCreate':
                toolEvent.taskSubject = block.input?.subject;
                toolEvent.taskDescription = (block.input?.description || '').slice(0, 500);
                toolEvent.taskActiveForm = block.input?.activeForm;
                break;
              case 'TaskUpdate':
                toolEvent.taskId = block.input?.taskId;
                toolEvent.taskStatus = block.input?.status;
                toolEvent.taskSubject = block.input?.subject;
                toolEvent.taskOwner = block.input?.owner;
                break;
            }
            results.push(toolEvent);
          } else if (block.type === 'thinking' && block.thinking) {
            results.push({
              timestamp: ts,
              kind: 'thinking',
              text: block.thinking.slice(0, 10000),
            });
          }
        }

        // If there's usage but no text/tool blocks emitted yet, emit a standalone usage event
        if (usage && results.length === 0) {
          results.push({ timestamp: ts, kind: 'assistant_text', text: '', usage });
        }
        break;
      }

      case 'progress': {
        const data = entry.data;
        if (!data) break;

        // Skip hook events entirely
        if (data.type === 'hook_progress') break;

        if (data.type === 'agent_progress' && data.content) {
          // Sub-agent progress — extract tool_use blocks
          const content = Array.isArray(data.content) ? data.content : [];
          let hasToolUse = false;
          for (const block of content) {
            if (block.type === 'tool_use') {
              hasToolUse = true;
              results.push({
                timestamp: ts,
                kind: 'subagent_tool_use',
                slug: data.slug,
                toolName: block.name,
                toolId: block.id,
                input: this._summarizeToolInput(block.name, block.input),
              });
            }
          }
          // If no tool_use blocks found, emit standalone agent_progress
          if (!hasToolUse) {
            results.push({
              timestamp: ts,
              kind: 'agent_progress',
              agentId: data.slug || data.agentId,
              prompt: (data.prompt || '').slice(0, 200),
            });
          }
        }
        break;
      }

      case 'user': {
        const msg = entry.message;
        if (!msg || !msg.content) break;
        let text = '';
        if (typeof msg.content === 'string') {
          text = msg.content.slice(0, 200);
        } else if (Array.isArray(msg.content)) {
          const textBlock = msg.content.find(b => b.type === 'text');
          if (textBlock) text = textBlock.text?.slice(0, 200) || '';
        }
        if (text) {
          results.push({ timestamp: ts, kind: 'user_message', text });
        }
        break;
      }

      case 'system': {
        if (entry.subtype === 'api_error') {
          results.push({
            timestamp: ts,
            kind: 'error',
            error: entry.error || entry.message || 'API error',
            retryAttempt: entry.retryAttempt,
          });
        }
        break;
      }
      // skip: 'result', 'file-history-snapshot', etc.
    }

    return results;
  }

  _summarizeToolInput(toolName, input) {
    if (!input) return '';
    switch (toolName) {
      case 'Read':
      case 'Write':
      case 'Edit':
        return input.file_path || input.path || '';
      case 'Glob':
        return input.pattern || '';
      case 'Bash':
        return (input.command || '').slice(0, 120);
      case 'Grep':
        return `"${input.pattern || ''}" in ${input.path || '.'}`;
      case 'Task':
        return `[${input.subagent_type || ''}] ${(input.description || '').slice(0, 100)}`;
      case 'ExitPlanMode':
        return 'Plan submitted';
      case 'EnterPlanMode':
        return 'Entering plan mode';
      case 'AskUserQuestion':
        return (input.questions?.[0]?.question || '').slice(0, 120);
      case 'Skill':
        return input.skill || '';
      case 'TeamCreate':
        return input.team_name || '';
      case 'SendMessage':
        return `→ ${input.recipient || ''}: ${(input.content || '').slice(0, 80)}`;
      case 'TaskCreate':
        return input.subject || '';
      case 'TaskUpdate':
        return `#${input.taskId || ''} → ${input.status || input.subject || ''}`;
      case 'TaskList':
        return 'List tasks';
      case 'TaskGet':
        return `#${input.taskId || ''}`;
      case 'WebSearch':
        return input.query || '';
      case 'WebFetch':
        return input.url || '';
      default:
        return JSON.stringify(input).slice(0, 100);
    }
  }

  unwatch(gameSessionId) {
    // Cancel deferred watch if pending
    if (this._deferredWatches && this._deferredWatches.has(gameSessionId)) {
      clearInterval(this._deferredWatches.get(gameSessionId));
      this._deferredWatches.delete(gameSessionId);
    }

    const projectDir = this.sessionDirs.get(gameSessionId);
    if (!projectDir) return;
    this.sessionDirs.delete(gameSessionId);

    const dirEntry = this.dirWatchers.get(projectDir);
    if (!dirEntry) return;

    dirEntry.gameSessionIds.delete(gameSessionId);

    // Remove file ownership for this session
    for (const [filePath, owner] of dirEntry.fileOwners) {
      if (owner === gameSessionId) {
        dirEntry.fileOwners.delete(filePath);
      }
    }

    console.log(`[ClaudeActivity] Unwatching session ${gameSessionId} (${dirEntry.gameSessionIds.size} remaining)`);

    // If no sessions left watching this dir, close the watcher entirely
    if (dirEntry.gameSessionIds.size === 0) {
      dirEntry.watcher.close();
      this.dirWatchers.delete(projectDir);

      // Clean up debounce timers for files in this dir
      for (const [filePath, timer] of this.debounceTimers) {
        if (filePath.startsWith(projectDir)) {
          clearTimeout(timer);
          this.debounceTimers.delete(filePath);
        }
      }
    }
  }

  /**
   * Read the most recent `count` parsed activity events from JSONL files.
   * Used to backfill the Activity panel on initial subscribe.
   * If gameSessionId is provided, only reads from the file owned by that session.
   */
  async getRecentEvents(workDir, count = 50, afterTimestamp = 0, gameSessionId = null) {
    const projectDir = getClaudeProjectDir(workDir);

    let fileNames;
    try {
      const entries = await fs.promises.readdir(projectDir);
      fileNames = entries.filter(f => f.endsWith('.jsonl'));
    } catch {
      return [];
    }
    if (fileNames.length === 0) return [];

    // If we have a file-owner mapping for this session, prefer that specific file
    let targetFile = null;
    if (gameSessionId) {
      const dirEntry = this.dirWatchers.get(projectDir);
      if (dirEntry) {
        for (const [fp, owner] of dirEntry.fileOwners) {
          if (owner === gameSessionId) {
            targetFile = fp;
            break;
          }
        }
      }
    }

    if (!targetFile) {
      // Fallback: find the most recently modified JSONL file after session creation
      // BUT skip files already owned by other sessions to prevent cross-session leakage
      const dirEntry = this.dirWatchers.get(projectDir);
      const ownedFiles = dirEntry ? new Set(dirEntry.fileOwners.values()) : new Set();
      const ownedPaths = dirEntry ? new Set(dirEntry.fileOwners.keys()) : new Set();

      let latest = null;
      for (const f of fileNames) {
        const fullPath = path.join(projectDir, f);
        // Skip files already assigned to a different session
        if (ownedPaths.has(fullPath) && dirEntry?.fileOwners.get(fullPath) !== gameSessionId) continue;
        try {
          const stat = await fs.promises.stat(fullPath);
          if (afterTimestamp && stat.mtimeMs < afterTimestamp) continue;
          if (!latest || stat.mtimeMs > latest.mtime) {
            latest = { name: f, mtime: stat.mtimeMs, size: stat.size, fullPath };
          }
        } catch { /* skip */ }
      }
      if (!latest || latest.size === 0) return [];
      targetFile = latest.fullPath;
    }

    let stat;
    try {
      stat = fs.statSync(targetFile);
    } catch {
      return [];
    }
    if (stat.size === 0) return [];

    console.log(`[ClaudeActivity] Reading recent events from ${path.basename(targetFile)} for session ${gameSessionId || '(any)'} (${stat.size} bytes)`);

    // Read last 200KB — more than enough for 50+ events
    const readSize = Math.min(stat.size, 200 * 1024);
    const startOffset = stat.size - readSize;

    const buf = Buffer.alloc(readSize);
    let fd;
    try {
      fd = fs.openSync(targetFile, 'r');
      fs.readSync(fd, buf, 0, readSize, startOffset);
      fs.closeSync(fd);
    } catch {
      if (fd !== undefined) try { fs.closeSync(fd); } catch { /* ignore */ }
      return [];
    }

    const text = buf.toString('utf-8');
    const lines = text.split('\n').filter(Boolean);

    // If we started mid-file, first line might be partial — skip it
    const startIdx = startOffset > 0 ? 1 : 0;

    // Parse from end to collect most recent first
    const events = [];
    for (let i = lines.length - 1; i >= startIdx; i--) {
      if (events.length >= count) break;
      try {
        const entry = JSON.parse(lines[i]);
        const parsed = this._parseEntry(entry);
        if (parsed.length > 0) events.unshift(...parsed);
      } catch { /* skip malformed */ }
    }

    return events.slice(-count);
  }

  unwatchAll() {
    for (const id of [...this.sessionDirs.keys()]) {
      this.unwatch(id);
    }
  }
}

// ─── Section 6: buildFileTree ────────────────────────────────────────────────

async function buildFileTree(dir, currentDepth = 0, baseDir = null, rootReal = null) {
  if (baseDir === null) baseDir = dir;
  if (rootReal === null) {
    try {
      rootReal = await fs.promises.realpath(baseDir);
    } catch {
      return [];
    }
  }
  if (currentDepth >= CONFIG.fileTreeMaxDepth) return [];

  let entries;
  try {
    const dirReal = await fs.promises.realpath(dir);
    assertInsidePath(rootReal, dirReal);
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  // Filter out excluded entries
  entries = entries.filter((e) => !shouldExclude(e.name));

  // Sort: dirs first, then files, alphabetical within each group
  entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  const nodes = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(baseDir, fullPath);

    // Resolve symlinks via stat (follows links) to get real type
    let realStat;
    try {
      const realPath = await fs.promises.realpath(fullPath);
      assertInsidePath(rootReal, realPath);
      realStat = await fs.promises.stat(fullPath);
    } catch {
      continue; // skip broken, escaping, or inaccessible entries
    }

    if (realStat.isDirectory()) {
      const children = await buildFileTree(fullPath, currentDepth + 1, baseDir, rootReal);
      nodes.push({
        name: entry.name,
        path: relPath,
        isDir: true,
        children,
      });
    } else if (realStat.isFile()) {
      nodes.push({
        name: entry.name,
        path: relPath,
        isDir: false,
        size: realStat.size,
      });
    }
  }

  return nodes;
}

// ─── Section 7: readClaudeConfig ─────────────────────────────────────────────

async function readClaudeConfig(workDir) {
  const claudeDir = path.join(workDir, '.claude');
  const files = [];

  async function walk(dir, prefix = '') {
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, rel);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        try {
          const content = await fs.promises.readFile(full, 'utf-8');
          files.push({ name: rel, content });
        } catch {
          // skip unreadable
        }
      }
    }
  }

  await walk(claudeDir);
  return files;
}

// ─── Section 8: WebSocket Server ─────────────────────────────────────────────

function createWSS(server, sessionManager, fileWatcher, tokenStore, auditLogger) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024 });

  const messageRoles = {
    'session.create': 'operator',
    'session.prompt': 'operator',
    'terminal.input': 'operator',
    'terminal.resize': 'operator',
    'session.kill': 'operator',
    'fs.browse': 'viewer',
    'files.requestTree': 'viewer',
    'file.read': 'viewer',
    'file.write': 'operator',
    'file.create': 'operator',
    'file.delete': 'operator',
    'file.upload': 'operator',
    'file.download': 'viewer',
    'claude.requestConfig': 'viewer',
    'claude.listConversations': 'viewer',
    'claude.watchActivity': 'viewer',
    'claude.unwatchActivity': 'viewer',
  };

  // --- Helpers ---

  function sendToClient(ws, type, payload) {
    if (ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify({ type, payload, timestamp: new Date().toISOString() }));
  }

  function broadcast(type, payload) {
    const msg = JSON.stringify({ type, payload, timestamp: new Date().toISOString() });
    for (const client of wss.clients) {
      if (client.readyState === client.OPEN) {
        client.send(msg);
      }
    }
  }

  function rejectUpgrade(socket, code, status = 401) {
    const body = JSON.stringify({ error: code });
    const reason = status === 403 ? 'Forbidden' : 'Unauthorized';
    socket.write([
      `HTTP/1.1 ${status} ${reason}`,
      'Connection: close',
      'Content-Type: application/json',
      `Content-Length: ${Buffer.byteLength(body)}`,
      '',
      body,
    ].join('\r\n'));
    socket.destroy();
  }

  server.on('upgrade', async (req, socket, head) => {
    let pathname = '';
    try {
      pathname = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`).pathname;
    } catch {
      socket.destroy();
      return;
    }

    if (pathname !== '/ws') {
      socket.destroy();
      return;
    }

    if (req.headers.origin && !isAllowedRequestOrigin(req)) {
      rejectUpgrade(socket, 'AUTH_FORBIDDEN', 403);
      return;
    }

    try {
      const auth = await authenticateRequest(req, tokenStore, {
        allowQueryToken: allowsLocalhostQueryToken(req),
      });
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.auth = auth;
        wss.emit('connection', ws, req);
      });
    } catch (err) {
      const code = err instanceof AuthError ? err.code : 'AUTH_INVALID';
      rejectUpgrade(socket, code);
    }
  });

  // --- Heartbeat ---

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws._alive === false) {
        ws.terminate();
        continue;
      }
      ws._alive = false;
      ws.ping();
    }
  }, CONFIG.heartbeatIntervalMs);

  wss.on('close', () => clearInterval(heartbeat));

  // --- Wire SessionManager events to WS broadcast ---

  sessionManager.on('session-output', (payload) => {
    broadcast('session.output', payload);
  });

  sessionManager.on('terminal-output', (payload) => {
    broadcast('terminal.output', payload);
  });

  sessionManager.on('session-exit', (payload) => {
    broadcast('session.terminated', payload);
  });

  fileWatcher.on('files-update', (payload) => {
    broadcast('files.update', payload);
  });

  // --- Connection handling ---

  wss.on('connection', (ws) => {
    ws._alive = true;
    ws.on('pong', () => { ws._alive = true; });

    // Replay: send all active session states (resume support)
    const activeSessions = sessionManager.list();
    for (const session of activeSessions) {
      sendToClient(ws, 'session.update', session);
    }

    // Replay: send raw terminal output for xterm.js rendering.
    // Uses a dedicated 'terminal.replay' event so the frontend can defer
    // writing until the xterm is attached to the DOM and properly sized,
    // preventing layout corruption from size mismatches.
    for (const session of activeSessions) {
      const rawData = sessionManager.getRawReplay(session.id);
      if (rawData) {
        const s = sessionManager.sessions.get(session.id);
        sendToClient(ws, 'terminal.replay', {
          sessionId: session.id,
          data: rawData,
          cols: s?.cols || CONFIG.ptyDefaultCols,
          rows: s?.rows || CONFIG.ptyDefaultRows,
        });
      }
    }

    // Replay: send current file counts (drinks)
    for (const session of activeSessions) {
      const counts = fileWatcher.latestCounts.get(session.id);
      if (counts) {
        sendToClient(ws, 'files.update', {
          sessionId: session.id,
          fileCount: counts.fileCount,
          drinkCount: counts.drinkCount,
        });
      }
    }

    // Message router
    ws.on('message', async (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        sendToClient(ws, 'error', { message: 'Invalid JSON', code: 'INVALID_MESSAGE' });
        return;
      }

      if (!msg.type || msg.payload === undefined) {
        sendToClient(ws, 'error', { message: 'Missing type or payload', code: 'INVALID_MESSAGE' });
        return;
      }

      const minimumRole = messageRoles[msg.type];
      if (minimumRole && !hasRole(ws.auth, minimumRole)) {
        sendToClient(ws, 'error', { message: 'Forbidden', code: 'AUTH_FORBIDDEN' });
        return;
      }

      try {
        switch (msg.type) {
          case 'session.create': {
            const { workDir, label, agentType = 'claude', resume = false } = msg.payload;
            if (!workDir) {
              sendToClient(ws, 'error', { message: 'workDir is required', code: 'INVALID_MESSAGE' });
              return;
            }
            const session = sessionManager.create(workDir, label, agentType, resume);
            broadcast('session.update', session);
            fileWatcher.watch(session.id, session.workDir);
            activityWatcher.watch(session.id, session.workDir);
            await auditLogger.write({
              operation: 'session.create',
              actor: auditActor(ws.auth),
              target: { sessionId: session.id, workDir: session.workDir, agentType: session.agentType },
              outcome: 'success',
            });
            break;
          }

          case 'session.prompt': {
            const { sessionId, prompt } = msg.payload;
            if (!sessionId || !prompt) {
              sendToClient(ws, 'error', { message: 'sessionId and prompt are required', code: 'INVALID_MESSAGE' });
              return;
            }
            sessionManager.sendPrompt(sessionId, prompt);
            break;
          }

          case 'terminal.input': {
            const { sessionId, data } = msg.payload;
            if (!sessionId || data === undefined) {
              sendToClient(ws, 'error', { message: 'sessionId and data are required', code: 'INVALID_MESSAGE' });
              return;
            }
            sessionManager.writeRaw(sessionId, data);
            break;
          }

          case 'terminal.resize': {
            const { sessionId, cols, rows } = msg.payload;
            if (!sessionId || !cols || !rows) {
              sendToClient(ws, 'error', { message: 'sessionId, cols, and rows are required', code: 'INVALID_MESSAGE' });
              return;
            }
            sessionManager.resize(sessionId, cols, rows);
            break;
          }

          case 'session.kill': {
            const { sessionId } = msg.payload;
            if (!sessionId) {
              sendToClient(ws, 'error', { message: 'sessionId is required', code: 'INVALID_MESSAGE' });
              return;
            }
            sessionManager.kill(sessionId);
            fileWatcher.unwatch(sessionId);
            activityWatcher.unwatch(sessionId);
            await auditLogger.write({
              operation: 'session.kill',
              actor: auditActor(ws.auth),
              target: { sessionId },
              outcome: 'success',
            });
            break;
          }

          case 'files.requestTree': {
            const { sessionId } = msg.payload;
            if (!sessionId) {
              sendToClient(ws, 'error', { message: 'sessionId is required', code: 'INVALID_MESSAGE' });
              return;
            }
            const session = sessionManager.get(sessionId);
            if (!session) {
              sendToClient(ws, 'error', { message: 'Session not found', code: 'SESSION_NOT_FOUND' });
              return;
            }
            const tree = await buildFileTree(session.workDir);
            sendToClient(ws, 'files.tree', { sessionId, tree });
            break;
          }

          case 'fs.browse': {
            const { path: dirPath } = msg.payload;
            const targetPath = dirPath || process.env.HOME || process.env.USERPROFILE || (IS_WINDOWS ? 'C:\\' : '/');
            try {
              const resolved = path.resolve(targetPath);
              const stat = await fs.promises.stat(resolved);
              if (!stat.isDirectory()) {
                sendToClient(ws, 'error', { message: `Not a directory: ${resolved}`, code: 'INVALID_PATH' });
                return;
              }
              const entries = await fs.promises.readdir(resolved, { withFileTypes: true });
              const filtered = entries
                .filter((e) => !shouldExclude(e.name))
                .map((e) => ({ name: e.name, isDir: e.isDirectory() }))
                .sort((a, b) => {
                  if (a.isDir && !b.isDir) return -1;
                  if (!a.isDir && b.isDir) return 1;
                  return a.name.localeCompare(b.name);
                });
              // Root detection: Unix "/" or Windows "C:\"
              const isRoot = resolved === '/' || /^[A-Z]:\\?$/i.test(resolved);
              const parent = isRoot ? null : path.dirname(resolved);
              sendToClient(ws, 'fs.browse.result', { path: resolved, parent, entries: filtered });
            } catch (err) {
              sendToClient(ws, 'error', { message: `Cannot read directory: ${err.message}`, code: 'INVALID_PATH' });
            }
            break;
          }

          case 'file.read': {
            const { sessionId, filePath } = msg.payload;
            if (!sessionId || !filePath) {
              sendToClient(ws, 'error', { message: 'sessionId and filePath are required', code: 'INVALID_MESSAGE' });
              return;
            }
            const readSession = sessionManager.get(sessionId);
            if (!readSession) {
              sendToClient(ws, 'error', { message: 'Session not found', code: 'SESSION_NOT_FOUND' });
              return;
            }
            try {
              const { realPath: absPath } = await resolveExistingInside(readSession.workDir, filePath);
              const stat = await fs.promises.stat(absPath);
              if (stat.size > FILE_TRANSFER_MAX_BYTES) {
                sendToClient(ws, 'error', { message: 'File too large (max 5MB)', code: 'INVALID_MESSAGE' });
                return;
              }
              const ext = path.extname(absPath).toLowerCase();
              const imageExts = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp']);
              const isImage = imageExts.has(ext);
              if (isImage) {
                const buf = await fs.promises.readFile(absPath);
                sendToClient(ws, 'file.content', {
                  sessionId,
                  filePath,
                  content: buf.toString('base64'),
                  encoding: 'base64',
                  fileType: 'image',
                  size: stat.size,
                });
              } else {
                const content = await fs.promises.readFile(absPath, 'utf-8');
                sendToClient(ws, 'file.content', {
                  sessionId,
                  filePath,
                  content,
                  encoding: 'utf-8',
                  fileType: 'text',
                  size: stat.size,
                });
              }
            } catch (err) {
              if (err instanceof PathSafetyError) {
                sendPathError(sendToClient, ws);
                return;
              }
              sendToClient(ws, 'error', { message: `Cannot read file: ${err.message}`, code: 'INVALID_MESSAGE' });
            }
            break;
          }

          case 'file.write': {
            const { sessionId, filePath, content } = msg.payload;
            if (!sessionId || !filePath || content === undefined) {
              sendToClient(ws, 'error', { message: 'sessionId, filePath, and content are required', code: 'INVALID_MESSAGE' });
              return;
            }
            const writeSession = sessionManager.get(sessionId);
            if (!writeSession) {
              sendToClient(ws, 'error', { message: 'Session not found', code: 'SESSION_NOT_FOUND' });
              return;
            }
            try {
              const { realPath: writeAbsPath } = await resolveWritableInside(writeSession.workDir, filePath);
              await fs.promises.writeFile(writeAbsPath, content, 'utf-8');
              sendToClient(ws, 'file.saved', { sessionId, filePath });
              await auditLogger.write({
                operation: 'file.write',
                actor: auditActor(ws.auth),
                target: { sessionId, path: filePath },
                outcome: 'success',
              });
            } catch (err) {
              if (err instanceof PathSafetyError) {
                sendPathError(sendToClient, ws);
                return;
              }
              sendToClient(ws, 'error', { message: `Cannot write file: ${err.message}`, code: 'INVALID_MESSAGE' });
            }
            break;
          }

          case 'file.upload': {
            const { sessionId, filePath, content, encoding } = msg.payload;
            if (!sessionId || !filePath || content === undefined) {
              sendToClient(ws, 'error', { message: 'sessionId, filePath, and content are required', code: 'INVALID_MESSAGE' });
              return;
            }
            const uploadSession = sessionManager.get(sessionId);
            if (!uploadSession) {
              sendToClient(ws, 'error', { message: 'Session not found', code: 'SESSION_NOT_FOUND' });
              return;
            }
            try {
              const { realPath: uploadAbsPath } = await resolveWritableInside(uploadSession.workDir, filePath);
              let buf;
              if (encoding === 'base64') {
                buf = Buffer.from(content, 'base64');
              } else {
                buf = Buffer.from(content, 'utf-8');
              }
              // 5MB decoded size limit
              if (buf.length > FILE_TRANSFER_MAX_BYTES) {
                sendToClient(ws, 'error', { message: 'File too large (max 5MB decoded)', code: 'INVALID_MESSAGE' });
                return;
              }
              // Ensure parent directory exists
              await fs.promises.mkdir(path.dirname(uploadAbsPath), { recursive: true });
              await fs.promises.writeFile(uploadAbsPath, buf);
              sendToClient(ws, 'file.uploaded', { sessionId, filePath });
              await auditLogger.write({
                operation: 'file.upload',
                actor: auditActor(ws.auth),
                target: { sessionId, path: filePath, size: buf.length, encoding: encoding || 'utf-8' },
                outcome: 'success',
              });
            } catch (err) {
              if (err instanceof PathSafetyError) {
                sendPathError(sendToClient, ws);
                return;
              }
              sendToClient(ws, 'error', { message: `Upload failed: ${err.message}`, code: 'INVALID_MESSAGE' });
            }
            break;
          }

          case 'file.download': {
            const { sessionId, filePath } = msg.payload;
            if (!sessionId || !filePath) {
              sendToClient(ws, 'error', { message: 'sessionId and filePath are required', code: 'INVALID_MESSAGE' });
              return;
            }
            const dlSession = sessionManager.get(sessionId);
            if (!dlSession) {
              sendToClient(ws, 'error', { message: 'Session not found', code: 'SESSION_NOT_FOUND' });
              return;
            }
            try {
              const { realPath: dlAbsPath } = await resolveExistingInside(dlSession.workDir, filePath);
              const stat = await fs.promises.stat(dlAbsPath);
              if (stat.size > FILE_TRANSFER_MAX_BYTES) {
                sendToClient(ws, 'error', { message: 'File too large (max 5MB)', code: 'INVALID_MESSAGE' });
                return;
              }
              const buf = await fs.promises.readFile(dlAbsPath);
              sendToClient(ws, 'file.downloadReady', {
                sessionId,
                filePath,
                content: buf.toString('base64'),
                size: stat.size,
              });
              await auditLogger.write({
                operation: 'file.download',
                actor: auditActor(ws.auth),
                target: { sessionId, path: filePath, size: stat.size },
                outcome: 'success',
              });
            } catch (err) {
              if (err instanceof PathSafetyError) {
                sendPathError(sendToClient, ws);
                return;
              }
              sendToClient(ws, 'error', { message: `Download failed: ${err.message}`, code: 'INVALID_MESSAGE' });
            }
            break;
          }

          case 'file.create': {
            const { sessionId, filePath, isDir } = msg.payload;
            if (!sessionId || !filePath) {
              sendToClient(ws, 'error', { message: 'sessionId and filePath are required', code: 'INVALID_MESSAGE' });
              return;
            }
            const createSession = sessionManager.get(sessionId);
            if (!createSession) {
              sendToClient(ws, 'error', { message: 'Session not found', code: 'SESSION_NOT_FOUND' });
              return;
            }
            try {
              const { realPath: createAbsPath } = await resolveWritableInside(createSession.workDir, filePath);
              if (isDir) {
                await fs.promises.mkdir(createAbsPath, { recursive: true });
              } else {
                // Ensure parent directory exists
                await fs.promises.mkdir(path.dirname(createAbsPath), { recursive: true });
                // Create empty file (fail if already exists)
                await fs.promises.writeFile(createAbsPath, '', { flag: 'wx' });
              }
              sendToClient(ws, 'file.created', { sessionId, filePath, isDir: !!isDir });
            } catch (err) {
              if (err instanceof PathSafetyError) {
                sendPathError(sendToClient, ws);
              } else if (err.code === 'EEXIST') {
                sendToClient(ws, 'error', { message: 'File already exists', code: 'INVALID_MESSAGE' });
              } else {
                sendToClient(ws, 'error', { message: `Cannot create: ${err.message}`, code: 'INVALID_MESSAGE' });
              }
            }
            break;
          }

          case 'file.delete': {
            const { sessionId, filePath } = msg.payload;
            if (!sessionId || !filePath) {
              sendToClient(ws, 'error', { message: 'sessionId and filePath are required', code: 'INVALID_MESSAGE' });
              return;
            }
            const delSession = sessionManager.get(sessionId);
            if (!delSession) {
              sendToClient(ws, 'error', { message: 'Session not found', code: 'SESSION_NOT_FOUND' });
              return;
            }
            try {
              const { root, requestedPath: delAbsPath, realPath } = await resolveExistingInside(delSession.workDir, filePath);
              // Prevent deleting the workDir itself
              if (realPath === root) {
                sendToClient(ws, 'error', { message: 'Cannot delete root directory', code: 'INVALID_MESSAGE' });
                return;
              }

              const lstat = await fs.promises.lstat(delAbsPath);
              if (lstat.isSymbolicLink()) {
                await fs.promises.unlink(delAbsPath);
              } else if (lstat.isDirectory()) {
                await fs.promises.rm(delAbsPath, { recursive: true });
              } else {
                await fs.promises.unlink(delAbsPath);
              }
              sendToClient(ws, 'file.deleted', { sessionId, filePath });
              await auditLogger.write({
                operation: 'file.delete',
                actor: auditActor(ws.auth),
                target: { sessionId, path: filePath },
                outcome: 'success',
              });
            } catch (err) {
              if (err instanceof PathSafetyError) {
                sendPathError(sendToClient, ws);
                return;
              }
              sendToClient(ws, 'error', { message: `Cannot delete: ${err.message}`, code: 'INVALID_MESSAGE' });
            }
            break;
          }

          case 'claude.watchActivity': {
            const { sessionId } = msg.payload;
            if (!sessionId) {
              sendToClient(ws, 'error', { message: 'sessionId is required', code: 'INVALID_MESSAGE' });
              return;
            }
            const watchSession = sessionManager.get(sessionId);
            if (!watchSession) {
              sendToClient(ws, 'error', { message: 'Session not found', code: 'SESSION_NOT_FOUND' });
              return;
            }
            activityWatcher.watch(sessionId, watchSession.workDir);

            // Backfill: send recent events, but only from files modified after this
            // session was created — prevents showing events from old conversations
            const sessionCreatedMs = new Date(watchSession.createdAt).getTime();
            const recentEvents = await activityWatcher.getRecentEvents(watchSession.workDir, 50, sessionCreatedMs, sessionId);
            if (recentEvents.length > 0) {
              sendToClient(ws, 'claude.activity', { gameSessionId: sessionId, events: recentEvents });
            }
            break;
          }

          case 'claude.listConversations': {
            const { workDir } = msg.payload;
            if (!workDir) {
              sendToClient(ws, 'error', { message: 'workDir is required', code: 'INVALID_MESSAGE' });
              return;
            }
            try {
              const conversations = await listClaudeConversations(workDir);
              sendToClient(ws, 'claude.conversations', { workDir, conversations });
            } catch (err) {
              sendToClient(ws, 'claude.conversations', { workDir, conversations: [] });
            }
            break;
          }

          case 'claude.unwatchActivity': {
            const { sessionId } = msg.payload;
            if (!sessionId) {
              sendToClient(ws, 'error', { message: 'sessionId is required', code: 'INVALID_MESSAGE' });
              return;
            }
            activityWatcher.unwatch(sessionId);
            break;
          }

          case 'claude.requestConfig': {
            const { sessionId } = msg.payload;
            if (!sessionId) {
              sendToClient(ws, 'error', { message: 'sessionId is required', code: 'INVALID_MESSAGE' });
              return;
            }
            const session = sessionManager.get(sessionId);
            if (!session) {
              sendToClient(ws, 'error', { message: 'Session not found', code: 'SESSION_NOT_FOUND' });
              return;
            }
            const files = await readClaudeConfig(session.workDir);
            sendToClient(ws, 'claude.config', { sessionId, files });
            break;
          }

          default:
            sendToClient(ws, 'error', { message: `Unknown message type: ${msg.type}`, code: 'INVALID_MESSAGE' });
        }
      } catch (err) {
        const code = err.message === 'SESSION_NOT_FOUND' ? 'SESSION_NOT_FOUND'
          : err.message === 'SESSION_TERMINATED' ? 'SESSION_TERMINATED'
          : err.message.includes('Maximum sessions') ? 'MAX_SESSIONS'
          : (err.message.includes('workDir') || err.message.includes('spawn')) ? 'SPAWN_FAILED'
          : 'INVALID_MESSAGE';
        console.error(`[ws] Error handling "${msg.type}": ${err.message}`);
        if (code === 'SPAWN_FAILED') {
          console.error(`[ws] Stack: ${err.stack}`);
        }
        sendToClient(ws, 'error', { message: err.message, code });
      }
    });

    ws.on('close', () => {
      // Cleanup if needed
    });
  });

  return { wss, broadcast };
}

// ─── Section 9: REST API ─────────────────────────────────────────────────────

function createRESTRouter(sessionManager, fileWatcher, broadcastFn, tokenStore, auditLogger) {
  const router = express.Router();

  router.use(requireAuth(tokenStore));

  router.get('/auth/whoami', requireMinimumRole('viewer'), (req, res) => {
    res.json(req.auth);
  });

  router.post('/auth/browser-session', requireMinimumRole('viewer'), async (req, res) => {
    const session = await tokenStore.createBrowserSession(req.auth);
    if (!session) {
      clearBrowserSessionCookie(req, res);
      return res.status(401).json({ error: 'AUTH_INVALID' });
    }
    setBrowserSessionCookie(req, res, session);
    await auditLogger.write({
      operation: 'auth.browser_session.create',
      actor: auditActor(req.auth),
      outcome: 'success',
    });
    res.json({ ok: true, auth: req.auth, expiresInSeconds: BROWSER_SESSION_MAX_AGE_SECONDS });
  });

  router.delete('/auth/browser-session', requireMinimumRole('viewer'), async (req, res) => {
    clearBrowserSessionCookie(req, res);
    await auditLogger.write({
      operation: 'auth.browser_session.clear',
      actor: auditActor(req.auth),
      outcome: 'success',
    });
    res.json({ ok: true });
  });

  router.post('/tokens', requireMinimumRole('admin'), async (req, res) => {
    try {
      const { name, role = 'operator' } = req.body || {};
      const created = await tokenStore.createToken({ name, role });
      await auditLogger.write({
        operation: 'token.create',
        actor: auditActor(req.auth),
        target: { tokenId: created.record.id, name: created.record.name, role: created.record.role },
        outcome: 'success',
      });
      res.status(201).json({ ...created.record, token: created.token });
    } catch (err) {
      if (err.code === 'INVALID_ROLE') {
        return res.status(400).json({ error: 'INVALID_ROLE' });
      }
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/tokens', requireMinimumRole('admin'), async (_req, res) => {
    res.json({ tokens: await tokenStore.list() });
  });

  router.delete('/tokens/:id', requireMinimumRole('admin'), async (req, res) => {
    const revoked = await tokenStore.revoke(req.params.id);
    if (!revoked) return res.status(404).json({ error: 'TOKEN_NOT_FOUND' });
    await auditLogger.write({
      operation: 'token.revoke',
      actor: auditActor(req.auth),
      target: { tokenId: revoked.id },
      outcome: 'success',
    });
    res.json({ ok: true });
  });

  router.post('/sessions', requireMinimumRole('operator'), async (req, res) => {
    try {
      const { cwd, workDir, label, agentType, resume } = req.body;
      const dir = cwd || workDir;
      if (!dir) {
        return res.status(400).json({ error: 'cwd or workDir is required' });
      }
      const session = sessionManager.create(dir, label, agentType, !!resume);
      broadcastFn('session.update', session);
      fileWatcher.watch(session.id, session.workDir);
      activityWatcher.watch(session.id, session.workDir);
      await auditLogger.write({
        operation: 'session.create',
        actor: auditActor(req.auth),
        target: { sessionId: session.id, workDir: session.workDir, agentType: session.agentType },
        outcome: 'success',
      });
      res.status(201).json(session);
    } catch (err) {
      const status = err.message.includes('Maximum sessions') ? 429
        : err.message.includes('does not exist') ? 400
        : 500;
      res.status(status).json({ error: err.message });
    }
  });

  router.get('/sessions', requireMinimumRole('viewer'), (req, res) => {
    const all = req.query.all === 'true';
    res.json(all ? sessionManager.listAll() : sessionManager.list());
  });

  router.get('/sessions/:id', requireMinimumRole('viewer'), (req, res) => {
    const session = sessionManager.get(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json(session);
  });

  router.delete('/sessions/:id', requireMinimumRole('operator'), async (req, res) => {
    const session = sessionManager.get(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    sessionManager.kill(req.params.id);
    fileWatcher.unwatch(req.params.id);
    activityWatcher.unwatch(req.params.id);
    await auditLogger.write({
      operation: 'session.kill',
      actor: auditActor(req.auth),
      target: { sessionId: req.params.id },
      outcome: 'success',
    });
    res.json({ ok: true });
  });

  return router;
}

// ─── Section 10: Startup & Shutdown ──────────────────────────────────────────

const app = express();
app.use(cors({
  origin(origin, callback) {
    callback(null, isAllowedOrigin(origin));
  },
  credentials: true,
}));
app.use(express.json());
app.use(rejectDisallowedBrowserOrigin);

const httpServer = http.createServer(app);

const sessionManager = new SessionManager();
const fileWatcher = new FileWatcher();
const activityWatcher = new ClaudeActivityWatcher();
const auditLogger = new AuditLogger();
const tokenStore = new TokenStore();

await tokenStore.init(auditLogger);

const { wss, broadcast } = createWSS(httpServer, sessionManager, fileWatcher, tokenStore, auditLogger);

// Wire ClaudeActivityWatcher events to WS broadcast
activityWatcher.on('activity', (payload) => {
  broadcast('claude.activity', payload);
});

app.use('/api', createRESTRouter(sessionManager, fileWatcher, broadcast, tokenStore, auditLogger));

// Health check
app.get('/health', (_req, res) => res.json({ ok: true }));

httpServer.listen(CONFIG.port, CONFIG.host, () => {
  console.log(`[Claude Punk] Backend running on http://${CONFIG.host}:${CONFIG.port}`);
  console.log(`[Claude Punk] WebSocket at ws://${CONFIG.host}:${CONFIG.port}/ws`);
  console.log(`[Claude Punk] Platform: ${process.platform} (${IS_WINDOWS ? 'Windows' : 'Unix'})`);
  console.log(`[Claude Punk] Shell: ${CONFIG.shell} ${JSON.stringify(CONFIG.shellArgs)}`);
  console.log(`[Claude Punk] Agent commands: ${JSON.stringify(CONFIG.agentCommands)}`);
  console.log(`[Claude Punk] Auto-run Claude: ${CONFIG.autoRunClaude}`);
  console.log(`[Claude Punk] Max sessions: ${CONFIG.maxSessions}`);
});

// Graceful shutdown
function shutdown(signal) {
  console.log(`\n[Claude Punk] Received ${signal}, shutting down...`);

  sessionManager.killAll();
  fileWatcher.unwatchAll();
  activityWatcher.unwatchAll();

  wss.close(() => {
    httpServer.close(() => {
      console.log('[Claude Punk] Server closed cleanly.');
      process.exit(0);
    });
  });

  // Force exit after timeout
  setTimeout(() => {
    console.log('[Claude Punk] Forcing exit after timeout.');
    process.exit(1);
  }, CONFIG.shutdownTimeoutMs).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
// Windows: Ctrl+C fires SIGINT, but closing the terminal fires 'exit' — no SIGTERM support
if (IS_WINDOWS) {
  process.on('SIGHUP', () => shutdown('SIGHUP'));
}
