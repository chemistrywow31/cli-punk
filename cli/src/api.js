import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveServerUrl, resolveToken } from './config.js';

export class ApiError extends Error {
  constructor(message, { status = 0, code = null, body = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

export async function request(method, route, { serverUrl, token, body, signal } = {}) {
  const baseUrl = serverUrl || resolveServerUrl();
  const url = new URL(route, `${baseUrl}/`);
  const headers = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;

  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });

  const text = await response.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!response.ok) {
    const code = parsed?.error || parsed?.code || null;
    const message = parsed?.message || parsed?.error || response.statusText || `HTTP ${response.status}`;
    throw new ApiError(message, { status: response.status, code, body: parsed });
  }

  return parsed;
}

export function createApi(options = {}) {
  const serverUrl = resolveServerUrl(options);
  const token = resolveToken(options);
  const common = { serverUrl, token };

  return {
    serverUrl,
    token,
    health: () => request('GET', '/health', common),
    whoami: () => request('GET', '/api/auth/whoami', common),
    listSessions: (all = false) => request('GET', `/api/sessions${all ? '?all=true' : ''}`, common),
    createSession: ({ workDir, label, agentType = 'claude', resume = false }) =>
      request('POST', '/api/sessions', {
        ...common,
        body: { workDir, label, agentType, resume },
      }),
    killSession: (sessionId) => request('DELETE', `/api/sessions/${encodeURIComponent(sessionId)}`, common),
    createToken: ({ name, role }) => request('POST', '/api/tokens', { ...common, body: { name, role } }),
    listTokens: () => request('GET', '/api/tokens', common),
    revokeToken: (tokenId) => request('DELETE', `/api/tokens/${encodeURIComponent(tokenId)}`, common),
  };
}

export async function readLocalUpload(localPath) {
  const content = await fs.readFile(localPath);
  const encoding = isLikelyText(localPath, content) ? 'utf-8' : 'base64';
  return {
    fileName: path.basename(localPath),
    content: encoding === 'base64' ? content.toString('base64') : content.toString('utf8'),
    encoding,
    size: content.length,
  };
}

export function isLikelyText(filePath, buffer) {
  const binaryExts = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp',
    '.pdf', '.zip', '.gz', '.tar', '.woff', '.woff2', '.ttf', '.otf',
    '.mp3', '.wav', '.ogg', '.mp4', '.webm', '.mov',
  ]);
  if (binaryExts.has(path.extname(filePath).toLowerCase())) return false;
  const sample = buffer.subarray(0, Math.min(buffer.length, 512));
  return !sample.includes(0);
}
