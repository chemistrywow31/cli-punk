/**
 * WebSocket client service — shared singleton for communicating with the backend.
 * Handles connection, reconnection, message routing, and event dispatch.
 */

export function classifySocketClose({ code, opened = false, authMode = 'browser-session', hasToken = false } = {}) {
  if (!hasToken) return 'auth required';
  if (code === 1008 || (authMode === 'query-token' && !opened && code === 1006)) return 'auth invalid';
  return 'offline';
}

export function isBackendUnavailableError(error) {
  return error?.code === 'BACKEND_UNAVAILABLE' || error?.status === 0;
}

export function backendPathPrefix(pathname = window.location.pathname) {
  return pathname === '/cp' || pathname.startsWith('/cp/') ? '/cp' : '';
}

export function defaultWebSocketUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = new URL(`${backendPathPrefix()}/ws`, `${protocol}//${window.location.host}`);
  return url.toString();
}

class WebSocketService {
  constructor() {
    this.ws = null;
    this.listeners = new Map();
    this.connected = false;
    this.reconnectTimer = null;
    this.reconnectDelay = 1000;
    this.maxReconnectDelay = 30000;
    this.tokenStorageKey = 'claude-punk-token';
    this.memoryToken = '';
    this.reconnectPaused = false;
    this.connectionSerial = 0;
    this.lastWsUrl = null;
  }

  connect(url) {
    const token = this.getToken();
    if (!token) {
      this.connected = false;
      this.emit('auth.required', {});
      return false;
    }

    this.reconnectPaused = false;
    const serial = ++this.connectionSerial;

    // Cancel any pending reconnect to prevent cascade
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Detach old WS handlers before closing to prevent its onclose
    // from triggering another reconnect cycle
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.close();
      this.ws = null;
    }

    const wsUrl = this.normalizeWsUrl(url || import.meta.env.VITE_BACKEND_WS || defaultWebSocketUrl());
    this.lastWsUrl = wsUrl;
    this.prepareSocketUrl(wsUrl, token)
      .then(({ url: socketUrl, authMode }) => {
        if (serial !== this.connectionSerial || this.reconnectPaused) return;
        this.openSocket(socketUrl, serial, { authMode });
      })
      .catch((error) => {
        if (serial !== this.connectionSerial) return;
        this.connected = false;
        this.reconnectPaused = true;
        if (isBackendUnavailableError(error)) {
          this.emit('backend.unavailable', { error, wsUrl: this.maskUrl(wsUrl) });
          return;
        }
        this.emit('auth.invalid', { error });
      });
    return true;
  }

  openSocket(wsUrl, serial, { authMode = 'browser-session' } = {}) {
    console.log('[WS] Connecting to:', this.maskUrl(wsUrl));
    let opened = false;
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      if (serial !== this.connectionSerial) return;
      opened = true;
      this.connected = true;
      this.reconnectDelay = 1000;
      this.emit('connection.open', {});
    };

    this.ws.onclose = (event) => {
      if (serial !== this.connectionSerial) return;
      this.connected = false;
      this.ws = null;
      this.emit('connection.close', { code: event.code, reason: event.reason, opened, authMode });
      if (!this.reconnectPaused && this.getToken()) this.scheduleReconnect();
    };

    this.ws.onerror = (err) => {
      this.emit('connection.error', { error: err });
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type && msg.payload !== undefined) {
          this.emit(msg.type, msg.payload);
        }
      } catch (e) {
        console.warn('[WS] Failed to parse message:', e);
      }
    };
  }

  scheduleReconnect() {
    if (this.reconnectPaused || !this.getToken()) return;
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
  }

  send(type, payload = {}) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[WS] Not connected, cannot send:', type);
      return false;
    }
    const msg = {
      type,
      payload,
      timestamp: new Date().toISOString(),
    };
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  on(type, callback) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type).add(callback);
    return () => this.off(type, callback);
  }

  off(type, callback) {
    const set = this.listeners.get(type);
    if (set) {
      set.delete(callback);
    }
  }

  emit(type, payload) {
    const set = this.listeners.get(type);
    if (set) {
      set.forEach((cb) => {
        try {
          cb(payload);
        } catch (e) {
          console.error(`[WS] Listener error for ${type}:`, e);
        }
      });
    }
  }

  disconnect() {
    this.connectionSerial += 1;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }

  getToken() {
    return this.memoryToken;
  }

  setToken(token) {
    this.memoryToken = token;
    this.reconnectDelay = 1000;
    this.reconnectPaused = false;
  }

  clearToken() {
    const token = this.getToken();
    if (token) this.clearBrowserSession(token);
    this.memoryToken = '';
    try {
      localStorage.removeItem(this.tokenStorageKey);
    } catch {
      // Ignore non-browser tests and unavailable storage.
    }
    this.reconnectPaused = true;
    this.disconnect();
  }

  normalizeWsUrl(rawUrl) {
    const url = new URL(rawUrl, window.location.href);
    if (url.protocol === 'http:') url.protocol = 'ws:';
    if (url.protocol === 'https:') url.protocol = 'wss:';
    return url.toString();
  }

  async prepareSocketUrl(wsUrl, token) {
    try {
      await this.establishBrowserSession(wsUrl, token);
      return { url: wsUrl, authMode: 'browser-session' };
    } catch (error) {
      if (![0, 401, 403].includes(error?.status) && this.canUseQueryToken(wsUrl)) {
        console.warn('[WS] Browser session unavailable; using localhost query-token fallback.');
        return { url: this.withAuthToken(wsUrl, token), authMode: 'query-token' };
      }
      throw error;
    }
  }

  async establishBrowserSession(wsUrl, token) {
    let response;
    try {
      response = await fetch(this.browserSessionUrl(wsUrl), {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${token}`,
        },
        credentials: 'include',
      });
    } catch (cause) {
      const error = new Error('BACKEND_UNAVAILABLE');
      error.code = 'BACKEND_UNAVAILABLE';
      error.status = 0;
      error.cause = cause;
      throw error;
    }
    if (!response.ok) {
      const error = new Error(`AUTH_SESSION_FAILED_${response.status}`);
      error.status = response.status;
      throw error;
    }
  }

  clearBrowserSession(token) {
    if (typeof window === 'undefined') return;
    const wsUrl = this.lastWsUrl || this.normalizeWsUrl(import.meta.env.VITE_BACKEND_WS || defaultWebSocketUrl());
    const headers = { accept: 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    fetch(this.browserSessionUrl(wsUrl), {
      method: 'DELETE',
      headers,
      credentials: 'include',
    }).catch(() => {});
  }

  browserSessionUrl(wsUrl) {
    const url = new URL(wsUrl, window.location.href);
    url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
    const prefix = url.pathname === '/cp/ws' || url.pathname.startsWith('/cp/') ? '/cp' : '';
    url.pathname = `${prefix}/api/auth/browser-session`;
    url.search = '';
    url.hash = '';
    return url.toString();
  }

  canUseQueryToken(rawUrl) {
    try {
      const url = new URL(rawUrl, window.location.href);
      return ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
    } catch {
      return false;
    }
  }

  withAuthToken(rawUrl, explicitToken = null) {
    const token = explicitToken || this.getToken();
    if (!token) return rawUrl;
    const url = new URL(rawUrl, window.location.href);
    url.searchParams.set('token', token);
    return url.toString();
  }

  maskUrl(rawUrl) {
    try {
      const url = new URL(rawUrl, window.location.href);
      if (url.searchParams.has('token')) url.searchParams.set('token', '***');
      return url.toString();
    } catch {
      return rawUrl.replace(/([?&]token=)[^&]+/, '$1***');
    }
  }

  pauseReconnect() {
    this.reconnectPaused = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // Convenience methods for the message protocol

  createSession(workDir, label, agentType = 'claude', resume = false) {
    return this.send('session.create', { workDir, label, agentType, resume });
  }

  sendPrompt(sessionId, prompt) {
    return this.send('session.prompt', { sessionId, prompt });
  }

  killSession(sessionId) {
    return this.send('session.kill', { sessionId });
  }

  browseDirectory(dirPath) {
    return this.send('fs.browse', { path: dirPath });
  }

  requestFileTree(sessionId) {
    return this.send('files.requestTree', { sessionId });
  }

  requestClaudeConfig(sessionId) {
    return this.send('claude.requestConfig', { sessionId });
  }

  sendTerminalInput(sessionId, data) {
    return this.send('terminal.input', { sessionId, data });
  }

  resizeTerminal(sessionId, cols, rows) {
    return this.send('terminal.resize', { sessionId, cols, rows });
  }

  readFile(sessionId, filePath) {
    return this.send('file.read', { sessionId, filePath });
  }

  writeFile(sessionId, filePath, content) {
    return this.send('file.write', { sessionId, filePath, content });
  }

  createFile(sessionId, filePath, isDir = false) {
    return this.send('file.create', { sessionId, filePath, isDir });
  }

  deleteFile(sessionId, filePath) {
    return this.send('file.delete', { sessionId, filePath });
  }

  uploadFile(sessionId, filePath, content, encoding = 'utf-8') {
    return this.send('file.upload', { sessionId, filePath, content, encoding });
  }

  downloadFile(sessionId, filePath) {
    return this.send('file.download', { sessionId, filePath });
  }

  listConversations(workDir) {
    return this.send('claude.listConversations', { workDir });
  }

  watchActivity(sessionId) {
    return this.send('claude.watchActivity', { sessionId });
  }

  unwatchActivity(sessionId) {
    return this.send('claude.unwatchActivity', { sessionId });
  }
}

// Singleton
const wsService = new WebSocketService();
export default wsService;
