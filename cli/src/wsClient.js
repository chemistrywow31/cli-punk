import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { normalizeServerUrl, resolveServerUrl, resolveToken } from './config.js';

export function buildWebSocketUrl(serverUrl) {
  const url = new URL(normalizeServerUrl(serverUrl));
  if (url.protocol === 'http:') url.protocol = 'ws:';
  if (url.protocol === 'https:') url.protocol = 'wss:';
  url.pathname = '/ws';
  url.search = '';
  url.hash = '';
  return url.toString();
}

export class ProtocolClient extends EventEmitter {
  constructor(options = {}) {
    super();
    this.serverUrl = resolveServerUrl(options);
    this.token = resolveToken(options);
    this.reconnect = options.reconnect !== false;
    this.reconnectDelay = 1000;
    this.maxReconnectDelay = 30000;
    this.ws = null;
    this.status = 'offline';
    this._closed = false;
    this._reconnectTimer = null;
  }

  connect() {
    this._closed = false;
    this._setStatus(this.ws ? 'reconnecting' : 'offline');

    const headers = {};
    if (this.token) headers.authorization = `Bearer ${this.token}`;

    this.ws = new WebSocket(buildWebSocketUrl(this.serverUrl), { headers });

    this.ws.on('open', () => {
      this.reconnectDelay = 1000;
      this._setStatus('online');
      this.emit('open');
    });

    this.ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        this.emit('protocolError', { message: 'Invalid JSON from backend' });
        return;
      }
      if (!msg.type || msg.payload === undefined) {
        this.emit('protocolError', { message: 'Invalid backend envelope' });
        return;
      }
      this.emit('message', msg);
      this.emit(msg.type, msg.payload, msg);
    });

    this.ws.on('close', (code) => {
      if (this._closed) {
        this._setStatus('offline');
        return;
      }
      this.ws = null;
      this._setStatus(code === 1008 ? 'forbidden' : 'reconnecting');
      this.emit('close', { code });
      if (this.reconnect) this._scheduleReconnect();
    });

    this.ws.on('error', (error) => {
      this.emit('connectionError', error);
    });
  }

  waitForOpen(timeoutMs = 5000) {
    if (this.ws?.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out connecting to ${this.serverUrl}`));
      }, timeoutMs);
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = (error) => {
        cleanup();
        reject(error);
      };
      const cleanup = () => {
        clearTimeout(timer);
        this.off('open', onOpen);
        this.off('connectionError', onError);
      };
      this.on('open', onOpen);
      this.on('connectionError', onError);
    });
  }

  send(type, payload = {}) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify({ type, payload, timestamp: new Date().toISOString() }));
    return true;
  }

  request(type, payload, successType, matches = () => true, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out waiting for ${successType}`));
      }, timeoutMs);

      const onSuccess = (response) => {
        if (!matches(response)) return;
        cleanup();
        resolve(response);
      };

      const onError = (error) => {
        cleanup();
        reject(new Error(error.message || error.code || 'Backend error'));
      };

      const cleanup = () => {
        clearTimeout(timer);
        this.off(successType, onSuccess);
        this.off('error', onError);
      };

      this.on(successType, onSuccess);
      this.on('error', onError);
      if (!this.send(type, payload)) {
        cleanup();
        reject(new Error('WebSocket is not connected'));
      }
    });
  }

  close() {
    this._closed = true;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this._setStatus('offline');
  }

  _scheduleReconnect() {
    if (this._reconnectTimer) return;
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this.connect();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
  }

  _setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    this.emit('status', status);
  }
}
