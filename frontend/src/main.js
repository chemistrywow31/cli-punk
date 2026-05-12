/**
 * Claude Punk web workbench.
 *
 * Browser frontend entry point using the existing backend protocol and UI
 * workflow modules, styled as a Bauhaus/cmux operational dashboard.
 */

import '@xterm/xterm/css/xterm.css';
import './styles/cyberpunk.css';
import './styles/dialog.css';
import './styles/terminal.css';
import './styles/folder-picker.css';
import './styles/file-warp.css';
import './styles/file-editor.css';
import './styles/theme-settings.css';
import './styles/resume-picker.css';
import './styles/bauhaus-workbench.css';

import TerminalTab from './ui/TerminalTab.js';
import FilesTab from './ui/FilesTab.js';
import ClaudeConfigTab from './ui/ClaudeConfigTab.js';
import FolderPicker from './ui/FolderPicker.js';
import ResumePicker from './ui/ResumePicker.js';
import ThemeSettings from './ui/ThemeSettings.js';
import wsService, { classifySocketClose } from './services/websocket.js';
import costTracker from './services/costTracker.js';
import { initFontOffset } from './services/fontSettings.js';
import { initStyleSettings } from './services/styleSettings.js';
import { parseAuthTokenInput } from './authToken.js';
import { formatSessionHotkey, nextSessionHotkey, sessionHotkeyFromEvent } from './sessionHotkeys.js';

initFontOffset();
initStyleSettings();

const PANE_RESTORE_HOTKEYS = {
  sessions: 'Ctrl+Shift+1',
  terminal: 'Ctrl+Shift+2',
  detail: 'Ctrl+Shift+3',
};

const PANE_RESTORE_CODES = {
  Digit1: 'sessions',
  Digit2: 'terminal',
  Digit3: 'detail',
};

const PANE_COLLAPSE_HOTKEYS = {
  sessions: 'Ctrl+Alt+1',
  terminal: 'Ctrl+Alt+2',
  detail: 'Ctrl+Alt+3',
};

const PANE_COLLAPSE_CODES = {
  Digit1: 'sessions',
  Digit2: 'terminal',
  Digit3: 'detail',
};

class WorkbenchApp {
  constructor() {
    this.sessions = new Map();
    this.hotkeys = new Map();
    this.letterToSession = new Map();
    this.activeSessionId = null;
    this.activeDetail = 'files';
    this.detailInstance = null;
    this.terminalInstance = null;
    this.connectionState = 'offline';
    this.notices = [];
    this.replayIds = null;
    this.replayTimer = null;
    this.collapsedPanes = new Set(readStoredArray('claude-punk-collapsed-panes'));
    this.focusPane = 'terminal';
    this.root = document.getElementById('app');
    this.buildShell();
    this.buildOverlays();
    this.bindUi();
    this.bindWebSocket();
    this.render();
    this.connectWithStoredToken();
  }

  buildShell() {
    this.root.innerHTML = `
      <div class="workbench-shell">
        <header class="wb-header">
          <div class="wb-brand">
            <div class="wb-mark">CP</div>
            <div>
              <h1>CLI Punk</h1>
              <span>Agent Workbench</span>
            </div>
          </div>
          <div class="wb-session-strip"></div>
          <div class="wb-actions">
            <button data-action="new"><span>New</span><kbd>N</kbd></button>
            <button data-action="resume"><span>Resume</span><kbd>R</kbd></button>
            <button data-action="auth"><span>Auth</span><kbd>Token</kbd></button>
            <button data-action="settings"><span>Style</span><kbd>F10</kbd></button>
          </div>
        </header>

        <section class="wb-status">
          <div><span class="label">Connection</span><strong class="wb-connection">OFFLINE</strong></div>
          <div><span class="label">Sessions</span><strong class="wb-count">0 / 16</strong></div>
          <div><span class="label">Protocol</span><strong>REST + WS</strong></div>
          <div><span class="label">Usage</span><strong class="wb-usage">unknown</strong></div>
        </section>

        <section class="wb-auth-panel hidden" aria-live="polite">
          <form class="wb-auth-form">
            <div>
              <h2>Backend Auth</h2>
              <p>Paste a CLI Punk bearer token. The page keeps it in memory, exchanges it for a browser session cookie, and keeps tokens out of URLs.</p>
            </div>
            <label>
              <span>Token / .env Snippet</span>
              <textarea class="wb-auth-input" autocomplete="off" spellcheck="false" placeholder="CLAUDE_PUNK_ADMIN_TOKEN=cp_..."></textarea>
            </label>
            <div class="wb-auth-actions">
              <button type="submit" data-action="auth-save"><span>Connect</span><kbd>Ctrl+Enter</kbd></button>
              <button type="button" data-action="auth-clear">Clear</button>
            </div>
            <div class="wb-auth-message"></div>
          </form>
        </section>

        <main class="wb-grid">
          <div class="wb-pane-restore hidden" aria-label="Hidden panes"></div>

          <aside class="wb-pane wb-sessions" data-pane="sessions">
            <div class="pane-head">
              <h2>Sessions</h2>
              <div class="pane-tools">
                <button data-action="new"><span>+</span><kbd>N</kbd></button>
                <button data-pane-toggle="sessions" title="Collapse sessions pane (${PANE_COLLAPSE_HOTKEYS.sessions})">-</button>
              </div>
            </div>
            <div class="wb-session-list"></div>
          </aside>
          <div class="wb-grid-resizer" data-resize-pane="sessions" title="Resize sessions pane"></div>

          <section class="wb-pane wb-terminal" data-pane="terminal">
            <div class="pane-head">
              <h2>Terminal + File Warp</h2>
              <div class="pane-head-right">
                <button data-pane-toggle="terminal" title="Collapse terminal pane (${PANE_COLLAPSE_HOTKEYS.terminal})">-</button>
              </div>
            </div>
            <div class="wb-terminal-mount"></div>
          </section>
          <div class="wb-grid-resizer" data-resize-pane="detail" title="Resize files pane"></div>

          <section class="wb-pane wb-detail" data-pane="detail">
            <div class="pane-head">
              <h2 class="wb-detail-title">Files</h2>
              <div class="pane-head-right">
                <div class="pane-tabs wb-detail-tabs">
                  <button data-detail="files" class="active"><span>Files</span><kbd>F2</kbd></button>
                  <button data-detail="config"><span>Config</span><kbd>F3</kbd></button>
                </div>
                <div class="wb-detail-actions">
                  <button data-action="refresh"><span>Refresh</span><kbd>F5</kbd></button>
                  <button data-action="kill"><span>Kill</span><kbd>F9</kbd></button>
                </div>
                <button data-pane-toggle="detail" title="Collapse files pane (${PANE_COLLAPSE_HOTKEYS.detail})">-</button>
              </div>
            </div>
            <div class="wb-detail-mount"></div>
          </section>
        </main>

        <footer class="wb-footer">
          <div class="wb-hotkeys">
            <kbd>Alt+1-9/0</kbd> switch session
            <kbd>N</kbd> New
            <kbd>F6</kbd> Pane
            <kbd>Shift+F6</kbd> Restore panes
            <kbd>Ctrl+Shift+1-3</kbd> Restore one
            <kbd>Ctrl+Alt+1-3</kbd> Hide one
            <kbd>F10</kbd> Style
            <kbd>R</kbd> Resume
            <kbd>Alt+←/→</kbd> Prev/Next
            <kbd>F1</kbd> Help
            <kbd>F2</kbd> Files
            <kbd>F3</kbd> Config
            <kbd>F5</kbd> Refresh
            <kbd>F9</kbd> Kill
            <kbd>Esc</kbd> Close
          </div>
          <div class="wb-notices"></div>
        </footer>
      </div>
    `;

    this.els = {
      shell: this.root.querySelector('.workbench-shell'),
      grid: this.root.querySelector('.wb-grid'),
      strip: this.root.querySelector('.wb-session-strip'),
      connection: this.root.querySelector('.wb-connection'),
      count: this.root.querySelector('.wb-count'),
      usage: this.root.querySelector('.wb-usage'),
      sessionList: this.root.querySelector('.wb-session-list'),
      terminalMount: this.root.querySelector('.wb-terminal-mount'),
      detailMount: this.root.querySelector('.wb-detail-mount'),
      detailTitle: this.root.querySelector('.wb-detail-title'),
      detailTabs: [...this.root.querySelectorAll('[data-detail]')],
      paneRestore: this.root.querySelector('.wb-pane-restore'),
      notices: this.root.querySelector('.wb-notices'),
      authPanel: this.root.querySelector('.wb-auth-panel'),
      authForm: this.root.querySelector('.wb-auth-form'),
      authInput: this.root.querySelector('.wb-auth-input'),
      authMessage: this.root.querySelector('.wb-auth-message'),
    };

    this.restorePaneSizes();
    this.applyPaneState();
  }

  buildOverlays() {
    this.folderPicker = new FolderPicker();
    this.resumePicker = new ResumePicker();
    this.themeSettings = new ThemeSettings();

    this.folderPicker.onSessionCreated = ({ label }) => this.notice(`session requested: ${label}`);
    this.folderPicker.onShow = () => this.root.classList.add('overlay-open');
    this.folderPicker.onHide = () => this.root.classList.remove('overlay-open');
    this.resumePicker.onShow = () => this.root.classList.add('overlay-open');
    this.resumePicker.onHide = () => this.root.classList.remove('overlay-open');
    this.themeSettings.onShow = () => this.root.classList.add('overlay-open');
    this.themeSettings.onHide = () => this.root.classList.remove('overlay-open');
  }

  bindUi() {
    this.root.addEventListener('click', (event) => {
      const actionButton = event.target.closest('[data-action]');
      if (actionButton) {
        if (actionButton.dataset.action === 'auth-save' || actionButton.dataset.action === 'auth-clear') {
          return;
        }
        this.handleAction(actionButton.dataset.action);
        return;
      }

      const detailButton = event.target.closest('[data-detail]');
      if (detailButton) {
        this.setDetail(detailButton.dataset.detail);
        return;
      }

      const paneRestoreAll = event.target.closest('[data-pane-restore-all]');
      if (paneRestoreAll) {
        this.restoreAllPanes();
        return;
      }

      const paneRestore = event.target.closest('[data-pane-restore]');
      if (paneRestore) {
        this.restorePane(paneRestore.dataset.paneRestore);
        return;
      }

      const paneToggle = event.target.closest('[data-pane-toggle]');
      if (paneToggle) {
        this.togglePane(paneToggle.dataset.paneToggle);
        return;
      }

      const sessionRow = event.target.closest('[data-session-id]');
      if (sessionRow) {
        this.setActiveSession(sessionRow.dataset.sessionId);
      }
    });

    this.root.querySelectorAll('[data-pane]').forEach((pane) => {
      pane.addEventListener('click', () => this.setFocusedPane(pane.dataset.pane));
    });
    this.bindPaneResize();

    this.els.authForm.addEventListener('submit', (event) => {
      event.preventDefault();
      this.saveAuthToken();
    });
    this.root.querySelector('[data-action="auth-clear"]').addEventListener('click', () => {
      this.clearAuthToken();
    });
    this.els.authInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        this.saveAuthToken();
      }
    });

    document.addEventListener('keydown', (event) => {
      const sessionHotkey = sessionHotkeyFromEvent(event);
      if (sessionHotkey) {
        const sessionId = this.letterToSession.get(sessionHotkey);
        if (sessionId) {
          event.preventDefault();
          this.setActiveSession(sessionId);
        }
        return;
      }

      if (event.altKey && event.key === 'ArrowLeft') {
        event.preventDefault();
        this.previousSession();
        return;
      }

      if (event.altKey && event.key === 'ArrowRight') {
        event.preventDefault();
        this.nextSession();
        return;
      }

      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (event.key === 'Escape') {
        if (this.closeTopOverlay()) {
          event.preventDefault();
          return;
        }
      }

      if (event.key === 'F1') {
        event.preventDefault();
        this.notice('Esc closes overlays / Alt+1-9/0 sessions / F6 panes / Ctrl+Shift+1-3 restore panes');
        return;
      }

      if (event.key === 'F2') {
        event.preventDefault();
        this.setDetail('files');
        this.setFocusedPane('detail');
        return;
      }

      if (event.key === 'F3') {
        event.preventDefault();
        this.setDetail('config');
        this.setFocusedPane('detail');
        return;
      }

      if (event.key === 'F5') {
        event.preventDefault();
        this.refreshActive();
        return;
      }

      if (event.key === 'F9') {
        event.preventDefault();
        this.killActive();
        return;
      }

      if (event.key === 'F10') {
        event.preventDefault();
        this.themeSettings.show();
        return;
      }

      if (event.key === 'F6') {
        event.preventDefault();
        if (event.shiftKey || this.visiblePaneCount() === 0) this.restoreAllPanes();
        else this.cycleFocusedPane();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.shiftKey) {
        const pane = PANE_RESTORE_CODES[event.code];
        if (pane) {
          event.preventDefault();
          this.restorePane(pane);
          return;
        }
        if (event.key.toLowerCase() === 'w') {
          event.preventDefault();
          this.restoreAllPanes();
          return;
        }
      }

      if ((event.ctrlKey || event.metaKey) && event.altKey) {
        const pane = PANE_COLLAPSE_CODES[event.code];
        if (pane) {
          event.preventDefault();
          this.collapsePane(pane);
          return;
        }
      }

      if (this.isTerminalFocused()) return;

      if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        this.folderPicker.show();
        return;
      }
      if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === 'r') {
        event.preventDefault();
        this.resumePicker.show();
        return;
      }
      if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        this.refreshActive();
      }
    }, true);
  }

  bindWebSocket() {
    wsService.on('auth.required', () => {
      this.connectionState = 'auth required';
      this.showAuthPanel('Token required before opening the WebSocket.');
      this.render();
    });

    wsService.on('auth.invalid', () => {
      this.connectionState = 'auth invalid';
      this.replayIds = null;
      if (this.replayTimer) clearTimeout(this.replayTimer);
      wsService.pauseReconnect();
      this.showAuthPanel('Token was rejected or the browser session could not be established.');
      this.notice('auth failed');
      this.render();
    });

    wsService.on('backend.unavailable', ({ wsUrl } = {}) => {
      this.connectionState = 'offline';
      this.replayIds = null;
      if (this.replayTimer) clearTimeout(this.replayTimer);
      wsService.pauseReconnect();
      this.showAuthPanel(`Backend is not reachable at ${this.backendLabel(wsUrl)}. Start or restart the backend, then connect again.`);
      this.notice('backend unavailable');
      this.render();
    });

    wsService.on('connection.open', () => {
      this.connectionState = 'online';
      this.replayIds = new Set();
      if (this.replayTimer) clearTimeout(this.replayTimer);
      this.replayTimer = setTimeout(() => this.reconcileSessions(), 1500);
      this.hideAuthPanel();
      this.notice('backend connected');
      this.render();
    });

    wsService.on('connection.close', ({ code, opened, authMode } = {}) => {
      const hasToken = Boolean(wsService.getToken());
      this.connectionState = classifySocketClose({ code, opened, authMode, hasToken });
      this.replayIds = null;
      if (this.replayTimer) clearTimeout(this.replayTimer);
      if (this.connectionState === 'auth invalid') {
        wsService.pauseReconnect();
        this.showAuthPanel('Token was rejected or the backend refused the WebSocket upgrade.');
        this.notice('auth failed');
      } else if (this.connectionState === 'auth required') {
        this.showAuthPanel('Token required before opening the WebSocket.');
        this.notice('auth required');
      } else if (!opened && code === 1006) {
        wsService.pauseReconnect();
        this.showAuthPanel('Backend WebSocket is unreachable. Make sure the backend is running, then connect again.');
        this.notice('backend unavailable');
      } else {
        this.notice('backend disconnected; reconnecting');
      }
      this.render();
    });

    wsService.on('connection.error', () => {
      this.connectionState = 'reconnecting';
      this.render();
    });

    wsService.on('session.update', (session) => {
      if (this.replayIds) this.replayIds.add(session.id);
      this.upsertSession(session);
    });

    wsService.on('session.terminated', ({ sessionId, exitCode }) => {
      const session = this.sessions.get(sessionId);
      if (session) {
        session.state = 'terminated';
        session.exitCode = exitCode;
      }
      this.freeHotkey(sessionId);
      TerminalTab.purge(sessionId);
      if (this.activeSessionId === sessionId) {
        const next = [...this.sessions.values()].find((item) => item.state !== 'terminated');
        this.activeSessionId = next?.id || null;
        this.renderActiveSession();
      }
      this.notice(`session ended ${sessionId.slice(0, 8)}`);
      this.render();
    });

    wsService.on('files.update', ({ sessionId, fileCount, drinkCount }) => {
      const session = this.sessions.get(sessionId);
      if (!session) return;
      session.fileCount = fileCount;
      session.drinkCount = drinkCount;
      this.render();
    });

    wsService.on('terminal.output', ({ sessionId, data }) => {
      costTracker.onTerminalOutput(sessionId, data);
      if (sessionId === this.activeSessionId) this.renderUsage();
    });

    wsService.on('error', (payload) => {
      this.notice(`${payload.code || 'ERROR'}: ${payload.message || 'backend error'}`);
    });
  }

  upsertSession(session) {
    const existing = this.sessions.get(session.id) || {};
    const merged = {
      ...existing,
      ...session,
      hotkey: existing.hotkey || this.assignHotkey(session.id),
      fileCount: existing.fileCount || 0,
      drinkCount: existing.drinkCount || 0,
    };
    this.sessions.set(session.id, merged);
    TerminalTab.getOrCreate(session.id);
    if (!this.activeSessionId || !this.sessions.has(this.activeSessionId)) {
      this.activeSessionId = session.id;
      this.renderActiveSession();
    }
    this.render();
  }

  reconcileSessions() {
    const ids = this.replayIds;
    this.replayIds = null;
    if (!ids) return;
    for (const sessionId of [...this.sessions.keys()]) {
      if (!ids.has(sessionId)) {
        this.sessions.delete(sessionId);
        this.freeHotkey(sessionId);
        TerminalTab.purge(sessionId);
      }
    }
    if (this.activeSessionId && !this.sessions.has(this.activeSessionId)) {
      this.activeSessionId = this.sessions.keys().next().value || null;
      this.renderActiveSession();
    }
    this.render();
  }

  assignHotkey(sessionId) {
    if (this.hotkeys.has(sessionId)) return this.hotkeys.get(sessionId);
    const hotkey = nextSessionHotkey(this.letterToSession);
    if (!hotkey) return '';
    this.hotkeys.set(sessionId, hotkey);
    this.letterToSession.set(hotkey, sessionId);
    return hotkey;
  }

  freeHotkey(sessionId) {
    const letter = this.hotkeys.get(sessionId);
    if (!letter) return;
    this.hotkeys.delete(sessionId);
    this.letterToSession.delete(letter);
  }

  setActiveSession(sessionId, { focusTerminal = false } = {}) {
    if (!this.sessions.has(sessionId)) return;
    this.activeSessionId = sessionId;
    this.renderActiveSession({ focusTerminal });
    this.render();
  }

  setDetail(detail) {
    if (!['files', 'config'].includes(detail)) detail = 'files';
    this.activeDetail = detail;
    this.els.detailTabs.forEach((button) => {
      button.classList.toggle('active', button.dataset.detail === detail);
    });
    this.renderDetail();
  }

  renderActiveSession({ focusTerminal = false } = {}) {
    this.detachTerminal();
    this.destroyDetail();
    const session = this.activeSession();
    if (!session) {
      this.els.terminalMount.innerHTML = '<div class="empty-state">Create or resume a session to start.</div>';
      this.els.detailMount.innerHTML = '<div class="empty-state">No session selected.</div>';
      return;
    }

    this.els.terminalMount.innerHTML = '';
    const terminal = TerminalTab.getOrCreate(session.id);
    terminal.agentType = session.agentType || 'claude';
    terminal.render(this.els.terminalMount, { focus: focusTerminal });
    this.terminalInstance = terminal;
    this.renderDetail();
  }

  renderDetail() {
    this.destroyDetail();
    const session = this.activeSession();
    if (!session) {
      this.els.detailMount.innerHTML = '<div class="empty-state">No active session.</div>';
      return;
    }

    this.els.detailMount.innerHTML = '';
    const detailMap = {
      files: ['Files', () => new FilesTab(session.id)],
      config: ['Config', () => new ClaudeConfigTab(session.id)],
    };
    const [title, build] = detailMap[this.activeDetail] || detailMap.files;
    this.els.detailTitle.textContent = title;
    this.detailInstance = build();
    this.detailInstance.render(this.els.detailMount);
  }

  detachTerminal() {
    if (this.terminalInstance) {
      this.terminalInstance.destroy();
      this.terminalInstance = null;
    }
  }

  destroyDetail() {
    if (this.detailInstance) {
      this.detailInstance.destroy();
      this.detailInstance = null;
    }
    this.els.detailMount.innerHTML = '';
  }

  activeSession() {
    return this.activeSessionId ? this.sessions.get(this.activeSessionId) : null;
  }

  handleAction(action) {
    switch (action) {
      case 'new':
        this.folderPicker.show();
        break;
      case 'resume':
        this.resumePicker.show();
        break;
      case 'auth':
        this.showAuthPanel();
        break;
      case 'settings':
        this.themeSettings.show();
        break;
      case 'refresh':
        this.refreshActive();
        break;
      case 'kill':
        this.killActive();
        break;
    }
  }

  refreshActive() {
    const session = this.activeSession();
    if (!session) return;
    wsService.requestFileTree(session.id);
    if (this.activeDetail === 'config') wsService.requestClaudeConfig(session.id);
    this.notice(`refresh requested for ${session.label}`);
  }

  killActive() {
    const session = this.activeSession();
    if (!session) return;
    if (window.confirm(`Kill session ${session.label || session.id}?`)) {
      wsService.killSession(session.id);
    }
  }

  closeTopOverlay() {
    for (const overlay of [this.folderPicker, this.resumePicker, this.themeSettings]) {
      if (overlay.visible) {
        overlay.hide();
        return true;
      }
    }
    return false;
  }

  render() {
    this.renderHeader();
    this.renderSessions();
    this.renderUsage();
    if (!this.terminalInstance && this.activeSession()) this.renderActiveSession();
  }

  renderHeader() {
    const active = [...this.sessions.values()].filter((session) => session.state !== 'terminated');
    this.els.connection.textContent = this.connectionState.toUpperCase();
    this.els.connection.dataset.state = this.connectionState;
    this.els.count.textContent = `${active.length} / 16`;
    this.els.strip.innerHTML = active.map((session, index) => `
      <button class="${session.id === this.activeSessionId ? 'active' : ''}" style="--session-color:${this.sessionColor(index)}" data-session-id="${session.id}">
        <span>${formatSessionHotkey(session.hotkey)}</span>${escapeHtml(session.label || session.id.slice(0, 8))}
      </button>
    `).join('');
  }

  renderSessions() {
    const sessions = [...this.sessions.values()];
    if (sessions.length === 0) {
      this.els.sessionList.innerHTML = '<div class="empty-state">No sessions yet. Use New to choose a project folder.</div>';
      return;
    }

    this.els.sessionList.innerHTML = sessions.map((session, index) => `
      <button class="session-row ${session.id === this.activeSessionId ? 'active' : ''}" style="--session-color:${this.sessionColor(index)}" data-session-id="${session.id}">
        <span class="session-key">${formatSessionHotkey(session.hotkey)}</span>
        <span class="session-main">
          <strong>${escapeHtml(session.label || session.id.slice(0, 8))}</strong>
          <small>${escapeHtml(session.agentType || 'agent')} · ${escapeHtml(basename(session.workDir || ''))}</small>
        </span>
        <span class="session-state ${session.state || ''}">${escapeHtml(session.state || 'unknown')}</span>
        <span class="session-files">${session.fileCount || 0} files</span>
      </button>
    `).join('');
  }

  renderUsage() {
    const session = this.activeSession();
    if (!session) {
      this.els.usage.textContent = 'unknown';
      return;
    }
    const cost = costTracker.getSessionCost(session.id);
    this.els.usage.textContent = cost
      ? `${costTracker.formatCost(cost.cost)} · ${costTracker.formatTokens(cost.inputTokens + cost.outputTokens)}`
      : 'unknown';
  }

  notice(message) {
    this.notices.push(message);
    this.notices = this.notices.slice(-3);
    this.els.notices.textContent = this.notices.join('  /  ');
  }

  sessionColor(index) {
    return `var(--session-color-${(index % 8) + 1})`;
  }

  restorePaneSizes() {
    const sessionsWidth = readStoredNumber('claude-punk-sessions-width', 280, 180, 520);
    const detailWidth = readStoredNumber('claude-punk-detail-width', 430, 280);
    this.els.grid.style.setProperty('--sessions-width', `${sessionsWidth}px`);
    this.els.grid.style.setProperty('--detail-width', `${detailWidth}px`);
  }

  bindPaneResize() {
    this.root.querySelectorAll('[data-resize-pane]').forEach((handle) => {
      handle.addEventListener('mousedown', (event) => {
        event.preventDefault();
        const pane = handle.dataset.resizePane;
        const startX = event.clientX;
        const styles = getComputedStyle(this.els.grid);
        const property = pane === 'sessions' ? '--sessions-width' : '--detail-width';
        const storageKey = pane === 'sessions' ? 'claude-punk-sessions-width' : 'claude-punk-detail-width';
        const min = pane === 'sessions' ? 180 : 280;
        const max = pane === 'sessions' ? 520 : Infinity;
        const start = parseInt(styles.getPropertyValue(property), 10) || (pane === 'sessions' ? 280 : 430);
        const overlay = document.createElement('div');
        overlay.className = 'wb-resize-overlay';
        document.body.appendChild(overlay);

        const onMove = (moveEvent) => {
          const delta = moveEvent.clientX - startX;
          const rawNext = pane === 'sessions' ? start + delta : start - delta;
          const next = Number.isFinite(max)
            ? Math.min(max, Math.max(min, rawNext))
            : Math.max(min, rawNext);
          this.els.grid.style.setProperty(property, `${next}px`);
        };
        const onUp = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          overlay.remove();
          const finalValue = parseInt(getComputedStyle(this.els.grid).getPropertyValue(property), 10);
          localStorage.setItem(storageKey, String(finalValue));
          this.terminalInstance?.fitAddon?.fit?.();
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    });
  }

  togglePane(pane) {
    const next = new Set(this.collapsedPanes);
    if (next.has(pane)) next.delete(pane);
    else next.add(pane);

    if (this.visiblePaneCount(next) === 0) {
      this.notice('keep at least one pane open; use Ctrl+Shift+W to restore all');
      return;
    }

    this.collapsedPanes = next;
    this.persistPaneState();
    this.applyPaneState();
    requestAnimationFrame(() => {
      this.terminalInstance?.fitAddon?.fit?.();
    });
  }

  collapsePane(pane) {
    if (!['sessions', 'terminal', 'detail'].includes(pane)) return;
    if (this.collapsedPanes.has(pane)) return;
    const next = new Set(this.collapsedPanes);
    next.add(pane);

    if (this.visiblePaneCount(next) === 0) {
      this.notice('keep at least one pane open; use Ctrl+Shift+W to restore all');
      return;
    }

    this.collapsedPanes = next;
    this.persistPaneState();
    this.applyPaneState();
    requestAnimationFrame(() => {
      this.terminalInstance?.fitAddon?.fit?.();
    });
  }

  restorePane(pane) {
    if (!['sessions', 'terminal', 'detail'].includes(pane)) return;
    this.collapsedPanes.delete(pane);
    this.persistPaneState();
    this.applyPaneState();
    this.setFocusedPane(pane);
    requestAnimationFrame(() => {
      this.terminalInstance?.fitAddon?.fit?.();
    });
  }

  restoreAllPanes() {
    this.collapsedPanes.clear();
    this.persistPaneState();
    this.applyPaneState();
    this.notice('panes restored');
    requestAnimationFrame(() => {
      this.terminalInstance?.fitAddon?.fit?.();
    });
  }

  persistPaneState() {
    localStorage.setItem('claude-punk-collapsed-panes', JSON.stringify([...this.collapsedPanes]));
  }

  applyPaneState() {
    for (const pane of ['sessions', 'terminal', 'detail']) {
      this.els.grid.classList.toggle(`pane-collapsed-${pane}`, this.collapsedPanes.has(pane));
      const button = this.root.querySelector(`[data-pane-toggle="${pane}"]`);
      if (button) button.textContent = this.collapsedPanes.has(pane) ? '+' : '-';
    }
    this.renderPaneRestore();
    if (this.collapsedPanes.has(this.focusPane)) {
      const firstVisible = ['terminal', 'sessions', 'detail'].find((pane) => !this.collapsedPanes.has(pane));
      if (firstVisible) this.focusPane = firstVisible;
    }
    this.setFocusedPane(this.focusPane);
  }

  renderPaneRestore() {
    const labels = { sessions: 'Sessions', terminal: 'Terminal', detail: 'Files' };
    const hidden = ['sessions', 'terminal', 'detail'].filter((pane) => this.collapsedPanes.has(pane));
    this.els.paneRestore.classList.toggle('hidden', hidden.length === 0);
    this.els.paneRestore.innerHTML = hidden.length === 0 ? '' : `
      <span>Hidden panes</span>
      ${hidden.map((pane) => `
        <button data-pane-restore="${pane}">
          <span>${labels[pane]}</span><kbd>${PANE_RESTORE_HOTKEYS[pane]}</kbd>
        </button>
      `).join('')}
      <button data-pane-restore-all>
        <span>All</span><kbd>Ctrl+Shift+W</kbd>
      </button>
    `;
  }

  setFocusedPane(pane) {
    this.focusPane = pane;
    this.root.querySelectorAll('[data-pane]').forEach((node) => {
      node.classList.toggle('is-focused', node.dataset.pane === pane);
    });
  }

  cycleFocusedPane() {
    const panes = ['sessions', 'terminal', 'detail'].filter((pane) => !this.collapsedPanes.has(pane));
    if (panes.length === 0) return;
    const index = panes.indexOf(this.focusPane);
    this.setFocusedPane(panes[(index + 1) % panes.length]);
  }

  visiblePaneCount(panes = this.collapsedPanes) {
    return ['sessions', 'terminal', 'detail'].filter((pane) => !panes.has(pane)).length;
  }

  previousSession() {
    const ids = this.activeSessionIds();
    if (!ids.length) return;
    const index = ids.indexOf(this.activeSessionId);
    this.setActiveSession(ids[(index - 1 + ids.length) % ids.length]);
  }

  nextSession() {
    const ids = this.activeSessionIds();
    if (!ids.length) return;
    const index = ids.indexOf(this.activeSessionId);
    this.setActiveSession(ids[(index + 1) % ids.length]);
  }

  activeSessionIds() {
    return [...this.sessions.values()]
      .filter((session) => session.state !== 'terminated')
      .map((session) => session.id);
  }

  isTerminalFocused() {
    return Boolean(document.activeElement?.closest?.('.xterm'));
  }

  connectWithStoredToken() {
    if (!wsService.getToken()) {
      this.connectionState = 'auth required';
      this.showAuthPanel('Paste a token to connect to the protected backend.');
      this.render();
      return;
    }
    this.connectionState = 'reconnecting';
    this.hideAuthPanel();
    this.render();
    wsService.connect();
  }

  showAuthPanel(message = '') {
    this.els.authPanel.classList.remove('hidden');
    this.els.authInput.value = wsService.getToken() || '';
    this.els.authMessage.textContent = message;
    setTimeout(() => this.els.authInput.focus(), 0);
  }

  hideAuthPanel() {
    this.els.authPanel.classList.add('hidden');
    this.els.authMessage.textContent = '';
  }

  backendLabel(rawUrl) {
    try {
      const url = new URL(rawUrl || '');
      url.username = '';
      url.password = '';
      url.pathname = '';
      url.search = '';
      url.hash = '';
      return url.toString().replace(/\/$/, '');
    } catch {
      return 'the configured backend';
    }
  }

  saveAuthToken() {
    const token = parseAuthTokenInput(this.els.authInput.value);
    if (!token) {
      this.showAuthPanel('Token cannot be empty.');
      return;
    }
    wsService.setToken(token);
    this.notice('auth token kept in memory');
    this.connectWithStoredToken();
  }

  clearAuthToken() {
    wsService.clearToken();
    this.sessions.clear();
    this.hotkeys.clear();
    this.letterToSession.clear();
    this.activeSessionId = null;
    this.detachTerminal();
    this.destroyDetail();
    this.connectionState = 'auth required';
    this.showAuthPanel('Token cleared. Paste a token to reconnect.');
    this.render();
  }
}

function basename(value) {
  return value.split(/[\\/]/).filter(Boolean).pop() || value || '';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function readStoredArray(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function readStoredNumber(key, fallback, min, max = Infinity) {
  const value = parseInt(localStorage.getItem(key) || '', 10);
  if (Number.isNaN(value)) return fallback;
  const minBounded = Math.max(min, value);
  return Number.isFinite(max) ? Math.min(max, minBounded) : minBounded;
}

new WorkbenchApp();
