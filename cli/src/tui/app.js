import blessed from 'blessed';
import path from 'node:path';
import { ProtocolClient } from '../wsClient.js';
import {
  HotkeyPool,
  getMacOptionLetter,
  getMetaLetter,
  isCtrlHotkey,
  isMetaHotkey,
  isNamedHotkey,
  isReservedHotkey,
  metaKeyFromEscapePrefix,
  rawHotkeyFromData,
  sequenceForTerminal,
} from '../hotkeys.js';
import { readQuickCommands, rememberFolder } from '../config.js';
import { flattenTree, formatBytes, quoteShellPath } from '../tree.js';
import { appendCapped, escapeTags, normalizeTerminalText } from './terminalRender.js';
import { bauhaus, statusColor } from './theme.js';

export class TuiApp {
  constructor(options = {}) {
    this.client = new ProtocolClient(options);
    this.hotkeys = new HotkeyPool();
    this.sessions = new Map();
    this.activeSessionId = null;
    this.mode = 'terminal';
    this.focusPane = 'terminal';
    this.pathMode = 'raw';
    this.treeFilter = '';
    this.treeSelection = 0;
    this.expandedPaths = new Set();
    this.notifications = [];
    this.fileRefreshTimers = new Map();
    this._renderTimer = null;
    this._pendingMetaEscapeTimer = null;
    this._suppressKeypressCount = 0;
  }

  async run() {
    this._buildScreen();
    this._wireClient();
    this._wireKeys();
    this.client.connect();
    this._notify(`connecting ${this.client.serverUrl}`);
    this._render();

    await new Promise((resolve) => {
      this._resolveRun = resolve;
    });
  }

  stop() {
    if (this._stopped) return;
    this._stopped = true;
    this._clearPendingMetaEscape();
    this.client.close();
    this.screen.destroy();
    this._resolveRun?.();
  }

  _buildScreen() {
    this.screen = blessed.screen({
      smartCSR: true,
      fullUnicode: true,
      dockBorders: true,
      autoPadding: false,
      title: 'Claude Punk CLI',
    });

    this.screen.program.hideCursor();

    this.header = blessed.box({
      parent: this.screen,
      top: 0,
      left: 0,
      width: '100%',
      height: 3,
      tags: true,
      style: { fg: bauhaus.text, bg: bauhaus.warm },
      border: { type: 'line', fg: bauhaus.text },
    });

    this.tabs = blessed.box({
      parent: this.screen,
      top: 3,
      left: 0,
      width: '100%',
      height: 3,
      tags: true,
      style: { fg: bauhaus.text, bg: bauhaus.panel },
      border: { type: 'line', fg: bauhaus.text },
    });

    this.sessionsPane = blessed.box({
      parent: this.screen,
      label: ' Sessions ',
      tags: true,
      keys: false,
      mouse: true,
      scrollable: true,
      alwaysScroll: true,
      style: { fg: bauhaus.text, bg: bauhaus.panel, border: { fg: bauhaus.text } },
      border: { type: 'line' },
      scrollbar: { ch: ' ', style: { bg: bauhaus.red } },
    });

    this.terminalPane = blessed.box({
      parent: this.screen,
      label: ' Terminal ',
      tags: false,
      keys: false,
      mouse: true,
      scrollable: true,
      alwaysScroll: true,
      style: { fg: bauhaus.codeText, bg: bauhaus.codeBg, border: { fg: bauhaus.blue } },
      border: { type: 'line' },
      scrollbar: { ch: ' ', style: { bg: bauhaus.yellow } },
    });

    this.fileWarpPane = blessed.box({
      parent: this.screen,
      label: ' File Warp ',
      tags: true,
      keys: false,
      mouse: true,
      scrollable: true,
      alwaysScroll: true,
      style: { fg: bauhaus.text, bg: bauhaus.panel, border: { fg: bauhaus.text } },
      border: { type: 'line' },
      scrollbar: { ch: ' ', style: { bg: bauhaus.blue } },
    });

    this.lowerPane = blessed.box({
      parent: this.screen,
      label: ' Activity / Notices ',
      tags: true,
      style: { fg: bauhaus.text, bg: bauhaus.panel, border: { fg: bauhaus.text } },
      border: { type: 'line' },
    });

    this.footer = blessed.box({
      parent: this.screen,
      bottom: 0,
      left: 0,
      width: '100%',
      height: 3,
      tags: true,
      style: { fg: bauhaus.text, bg: bauhaus.warm },
      border: { type: 'line', fg: bauhaus.text },
    });

    this.prompt = blessed.prompt({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '70%',
      height: 7,
      tags: true,
      hidden: true,
      border: { type: 'line', fg: bauhaus.text },
      style: {
        fg: bauhaus.text,
        bg: bauhaus.panel,
        border: { fg: bauhaus.text },
        focus: { border: { fg: bauhaus.red } },
      },
    });

    this.confirm = blessed.question({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '70%',
      height: 7,
      tags: true,
      hidden: true,
      border: { type: 'line', fg: bauhaus.text },
      style: {
        fg: bauhaus.text,
        bg: bauhaus.errorBg,
        border: { fg: bauhaus.red },
      },
    });

    this.screen.on('resize', () => {
      this._layout();
      this._sendResize();
      this._render();
    });

    this._layout();
  }

  _layout() {
    const width = this.screen.width || 120;
    const height = this.screen.height || 36;
    const compact = width < 100 || height < 28;
    const bodyTop = 6;
    const footerHeight = 3;
    const lowerHeight = compact ? 0 : 7;
    const bodyHeight = Math.max(8, height - bodyTop - footerHeight - lowerHeight);
    const leftWidth = compact ? Math.max(18, Math.floor(width * 0.24)) : Math.max(22, Math.floor(width * 0.2));
    const rightWidth = compact ? 0 : Math.max(24, Math.floor(width * 0.24));
    const terminalWidth = Math.max(30, width - leftWidth - rightWidth);

    this.sessionsPane.top = bodyTop;
    this.sessionsPane.left = 0;
    this.sessionsPane.width = leftWidth;
    this.sessionsPane.height = bodyHeight;

    this.terminalPane.top = bodyTop;
    this.terminalPane.left = leftWidth;
    this.terminalPane.width = terminalWidth;
    this.terminalPane.height = bodyHeight;

    this.fileWarpPane.top = bodyTop;
    this.fileWarpPane.left = leftWidth + terminalWidth;
    this.fileWarpPane.width = rightWidth;
    this.fileWarpPane.height = bodyHeight;
    this.fileWarpPane.hidden = compact;

    this.lowerPane.top = bodyTop + bodyHeight;
    this.lowerPane.left = 0;
    this.lowerPane.width = '100%';
    this.lowerPane.height = lowerHeight;
    this.lowerPane.hidden = compact;
  }

  _wireClient() {
    this.client.on('status', (status) => {
      this._notify(`connection ${status}`);
      this._render();
    });

    this.client.on('session.update', (session) => {
      const existing = this.sessions.get(session.id) || {
        rawOutput: '',
        terminalText: '',
        tree: [],
        fileCount: 0,
        drinkCount: 0,
        quickCommands: readQuickCommands(session.agentType),
      };
      existing.meta = session;
      existing.hotkey = this.hotkeys.assign(session.id);
      this.sessions.set(session.id, existing);
      if (!this.activeSessionId || !this.sessions.has(this.activeSessionId)) {
        this.setActiveSession(session.id);
      }
      this._requestTree(session.id);
      this._render();
    });

    this.client.on('session.terminated', ({ sessionId, exitCode }) => {
      const session = this.sessions.get(sessionId);
      if (session) {
        session.meta = { ...session.meta, state: 'terminated', exitCode };
        this.hotkeys.free(sessionId);
      }
      if (this.activeSessionId === sessionId) this._activateNextSession();
      this._notify(`session terminated ${sessionId.slice(0, 8)} exit=${exitCode}`);
      this._render();
    });

    this.client.on('terminal.replay', ({ sessionId, data, cols, rows }) => {
      const session = this._ensureSessionShell(sessionId);
      session.rawOutput = data || '';
      session.terminalText = normalizeTerminalText(session.rawOutput);
      session.replaySize = Buffer.byteLength(data || '', 'utf8');
      session.ptyCols = cols;
      session.ptyRows = rows;
      this._render();
    });

    this.client.on('terminal.output', ({ sessionId, data }) => {
      const session = this._ensureSessionShell(sessionId);
      session.rawOutput = appendCapped(session.rawOutput, data);
      session.terminalText = normalizeTerminalText(session.rawOutput);
      if (sessionId === this.activeSessionId) {
        this._renderTerminal();
      }
    });

    this.client.on('files.update', ({ sessionId, fileCount, drinkCount }) => {
      const session = this._ensureSessionShell(sessionId);
      session.fileCount = fileCount;
      session.drinkCount = drinkCount;
      if (this.fileRefreshTimers.has(sessionId)) clearTimeout(this.fileRefreshTimers.get(sessionId));
      this.fileRefreshTimers.set(sessionId, setTimeout(() => {
        this.fileRefreshTimers.delete(sessionId);
        this._requestTree(sessionId);
      }, 500));
      this._render();
    });

    this.client.on('files.tree', ({ sessionId, tree }) => {
      const session = this._ensureSessionShell(sessionId);
      session.tree = tree || [];
      this.treeSelection = 0;
      this._render();
    });

    this.client.on('claude.activity', ({ gameSessionId, events }) => {
      const session = this._ensureSessionShell(gameSessionId);
      session.activity = [...(session.activity || []), ...(events || [])].slice(-50);
      this._renderLower();
    });

    this.client.on('error', (error) => {
      this._notify(`backend error: ${error.code || 'ERROR'} ${error.message || ''}`);
      this._render();
    });

    this.client.on('connectionError', (error) => {
      this._notify(`connection error: ${error.message}`);
      this._render();
    });
  }

  _wireKeys() {
    this.screen.program.on('data', (data) => {
      this._handleRawInputData(data);
    });
    this.screen.on('keypress', (ch, key = {}) => {
      this._handleKeypress(ch, key);
    });
  }

  _handleRawInputData(data) {
    const parsed = rawHotkeyFromData(data);
    if (!parsed) return;
    this._suppressKeypressCount += parsed.suppressKeypresses;
    this._handleKeypress(null, parsed.key, { fromRaw: true });
  }

  _handleKeypress(ch, key = {}, options = {}) {
    if (!options.fromRaw && this._suppressKeypressCount > 0) {
      this._suppressKeypressCount -= 1;
      return;
    }

    if (this._isCtrlBacktick(key)) {
      return this._handleCtrlBacktick();
    }

    if (this.mode === 'prompt') return;

    if (!options.fromRaw && this._consumePendingMetaEscape()) {
      const metaKey = metaKeyFromEscapePrefix(ch, key);
      if (metaKey) return this._handleKeypress(null, metaKey, { fromRaw: true });
    }

    const metaLetter = getMetaLetter(key);
    if (metaLetter) {
      const sessionId = this.hotkeys.getSession(metaLetter);
      if (sessionId) this.setActiveSession(sessionId);
      return;
    }

    const macOptionLetter = getMacOptionLetter(ch, key);
    if (macOptionLetter) {
      const sessionId = this.hotkeys.getSession(macOptionLetter);
      if (sessionId) this.setActiveSession(sessionId);
      return;
    }

    if (isMetaHotkey(key, 'left')) return this._previousSession();
    if (isMetaHotkey(key, 'right')) return this._nextSession();
    if (isCtrlHotkey(key, 'n')) return this._newSessionFlow();
    if (isCtrlHotkey(key, 'p')) return this._commandPalette();
    if (isCtrlHotkey(key, 'w')) {
      this.mode = 'command';
      this.focusPane = this.focusPane === 'files' ? 'terminal' : 'files';
      this._render();
      return;
    }
    if (isNamedHotkey(key, 'f1')) return this._help();
    if (isNamedHotkey(key, 'f2')) {
      this.mode = 'command';
      this.focusPane = 'files';
      this._render();
      return;
    }
    if (isNamedHotkey(key, 'f3')) {
      this.mode = 'command';
      this._notify('file editor is not implemented in this TUI yet');
      this._render();
      return;
    }
    if (isNamedHotkey(key, 'f4')) {
      this.mode = 'command';
      this.focusPane = 'activity';
      this._notify('activity is shown in the lower pane when events are available');
      this._render();
      return;
    }
    if (isNamedHotkey(key, 'f5')) return this._requestTree(this.activeSessionId);
    if (isNamedHotkey(key, 'f9')) return this._confirmKill();
    if (isNamedHotkey(key, 'escape')) {
      if (this.mode === 'terminal') {
        this._startPendingMetaEscape();
        return;
      }
      this.mode = 'terminal';
      this.focusPane = 'terminal';
      this._render();
      return;
    }

    if (this.mode === 'command') {
      this._handleCommandKey(ch, key);
      return;
    }

    if (isReservedHotkey(key)) return;
    this._sendTerminalInput(sequenceForTerminal(ch, key));
  }

  _handleCommandKey(ch, key = {}) {
    if (ch === 'q') return this.stop();
    if (ch === 'n') return this._newSessionFlow();
    if (ch === 'k') return this._confirmKill();
    if (ch === 'r') return this._requestTree(this.activeSessionId);
    if (ch === 'm') {
      this.pathMode = this.pathMode === 'raw' ? 'quoted' : 'raw';
      this._render();
      return;
    }
    if (/^[1-9]$/.test(ch || '')) {
      return this._insertQuickCommand(Number(ch) - 1);
    }
    if (ch === '/') return this._filterTreeFlow();

    if (this.focusPane === 'files') {
      if (key.name === 'up') {
        this.treeSelection = Math.max(0, this.treeSelection - 1);
        this._renderFileWarp();
        return;
      }
      if (key.name === 'down') {
        const rows = this._flatTree();
        this.treeSelection = Math.min(Math.max(0, rows.length - 1), this.treeSelection + 1);
        this._renderFileWarp();
        return;
      }
      if (key.name === 'enter') {
        this._insertSelectedPath();
        return;
      }
      if (key.name === 'space') {
        this._toggleSelectedDir();
      }
    }
  }

  _isCtrlBacktick(key) {
    return isCtrlHotkey(key, '`');
  }

  _handleCtrlBacktick() {
    this._clearPendingMetaEscape();
    if (this.mode === 'prompt') {
      this._closeModal();
      this.mode = 'terminal';
      this.focusPane = 'terminal';
      this._notify('closed modal');
      this._render();
      return;
    }

    this.mode = this.mode === 'terminal' ? 'command' : 'terminal';
    this.focusPane = this.mode === 'terminal' ? 'terminal' : this.focusPane;
    this._notify(this.mode === 'command' ? 'command mode' : 'terminal focus');
    this._render();
  }

  _startPendingMetaEscape() {
    this._clearPendingMetaEscape();
    this._pendingMetaEscapeTimer = setTimeout(() => {
      this._pendingMetaEscapeTimer = null;
    }, 120);
  }

  _consumePendingMetaEscape() {
    if (!this._pendingMetaEscapeTimer) return false;
    this._clearPendingMetaEscape();
    return true;
  }

  _clearPendingMetaEscape() {
    if (!this._pendingMetaEscapeTimer) return;
    clearTimeout(this._pendingMetaEscapeTimer);
    this._pendingMetaEscapeTimer = null;
  }

  _closeModal() {
    this.prompt?._?.input?.cancel?.();
    this.confirm?._?.cancel?.emit?.('press');
    this.prompt?.hide?.();
    this.confirm?.hide?.();
    this.screen?.program?.hideCursor?.();
  }

  setActiveSession(sessionId) {
    if (!this.sessions.has(sessionId)) return;
    this.activeSessionId = sessionId;
    this.treeSelection = 0;
    this._requestTree(sessionId);
    this._sendResize();
    this._render();
  }

  _activateNextSession() {
    const active = [...this.sessions.values()].find((session) => session.meta?.state !== 'terminated');
    this.activeSessionId = active?.meta?.id || null;
  }

  _previousSession() {
    const ids = this._activeSessionIds();
    if (ids.length === 0) return;
    const idx = ids.indexOf(this.activeSessionId);
    this.setActiveSession(ids[(idx - 1 + ids.length) % ids.length]);
  }

  _nextSession() {
    const ids = this._activeSessionIds();
    if (ids.length === 0) return;
    const idx = ids.indexOf(this.activeSessionId);
    this.setActiveSession(ids[(idx + 1) % ids.length]);
  }

  _activeSessionIds() {
    return [...this.sessions.values()]
      .filter((session) => session.meta?.state !== 'terminated')
      .map((session) => session.meta.id);
  }

  _ensureSessionShell(sessionId) {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        meta: { id: sessionId, label: sessionId.slice(0, 8), state: 'active', agentType: 'unknown', workDir: '' },
        hotkey: this.hotkeys.assign(sessionId),
        rawOutput: '',
        terminalText: '',
        tree: [],
        fileCount: 0,
        drinkCount: 0,
        quickCommands: [],
      });
    }
    return this.sessions.get(sessionId);
  }

  _sendTerminalInput(data) {
    if (!data || !this.activeSessionId) return;
    const ok = this.client.send('terminal.input', { sessionId: this.activeSessionId, data });
    if (!ok) this._notify('terminal input dropped: websocket offline');
  }

  _sendResize() {
    if (!this.activeSessionId || this.client.status !== 'online') return;
    const cols = Math.max(20, Number(this.terminalPane.width) - 2);
    const rows = Math.max(6, Number(this.terminalPane.height) - 2);
    this.client.send('terminal.resize', { sessionId: this.activeSessionId, cols, rows });
  }

  _requestTree(sessionId) {
    if (!sessionId || this.client.status !== 'online') return;
    this.client.send('files.requestTree', { sessionId });
  }

  _flatTree() {
    const active = this.sessions.get(this.activeSessionId);
    return flattenTree(active?.tree || [], { filter: this.treeFilter, expanded: this.expandedPaths });
  }

  _insertSelectedPath() {
    const rows = this._flatTree();
    const row = rows[this.treeSelection];
    if (!row || !this.activeSessionId) return;
    const data = this.pathMode === 'quoted' ? quoteShellPath(row.path) : row.path;
    this.client.send('terminal.input', { sessionId: this.activeSessionId, data });
    this._notify(`inserted ${data}`);
    this.mode = 'terminal';
    this.focusPane = 'terminal';
    this._render();
  }

  _insertQuickCommand(index) {
    const active = this.sessions.get(this.activeSessionId);
    const command = active?.quickCommands?.[index];
    if (!command || !this.activeSessionId) return;
    this.client.send('terminal.input', { sessionId: this.activeSessionId, data: command.command });
    this._notify(`inserted command ${command.label}`);
    this.mode = 'terminal';
    this.focusPane = 'terminal';
    this._render();
  }

  _toggleSelectedDir() {
    const row = this._flatTree()[this.treeSelection];
    if (!row?.isDir) return;
    if (this.expandedPaths.has(row.path)) this.expandedPaths.delete(row.path);
    else this.expandedPaths.add(row.path);
    this._renderFileWarp();
  }

  _newSessionFlow() {
    this.mode = 'prompt';
    this.prompt.input('Work directory', process.cwd(), (err, workDir) => {
      if (err || !workDir) return this._endPrompt();
      this.prompt.input('Agent type: claude or codex', 'claude', (agentErr, rawAgent) => {
        if (agentErr) return this._endPrompt();
        const agentType = rawAgent?.trim() === 'codex' ? 'codex' : 'claude';
        this.prompt.input('Label', path.basename(path.resolve(workDir)), (labelErr, label) => {
          this._endPrompt();
          if (labelErr) return;
          const resolved = path.resolve(workDir);
          rememberFolder(resolved);
          const ok = this.client.send('session.create', {
            workDir: resolved,
            label: label?.trim() || path.basename(resolved),
            agentType,
            resume: false,
          });
          this._notify(ok ? `creating ${agentType} session` : 'cannot create session while offline');
        });
      });
    });
    this.screen.render();
  }

  _filterTreeFlow() {
    this.mode = 'prompt';
    this.prompt.input('File Warp filter', this.treeFilter, (err, value) => {
      this._endPrompt();
      if (err) return;
      this.treeFilter = value || '';
      this.treeSelection = 0;
      this.focusPane = 'files';
      this.mode = 'command';
      this._render();
    });
    this.screen.render();
  }

  _commandPalette() {
    this.mode = 'command';
    this._notify('palette: n new, r refresh, / filter, m path mode, k kill, q quit');
    this._render();
  }

  _help() {
    this._notify('Ctrl+` mode/close | Ctrl+N new | Alt/Option+a-z switch | F2 warp | F5 refresh | F9 kill');
    this._render();
  }

  _confirmKill() {
    const active = this.sessions.get(this.activeSessionId);
    if (!active?.meta) return;
    this.mode = 'prompt';
    this.confirm.ask(`Kill ${active.meta.label || active.meta.id}?`, (err, answer) => {
      this._endPrompt();
      if (!err && answer) {
        this.client.send('session.kill', { sessionId: active.meta.id });
        this._notify(`kill requested ${active.meta.label}`);
      }
    });
    this.screen.render();
  }

  _endPrompt() {
    this.mode = 'command';
    this.screen.program.hideCursor();
    this._render();
  }

  _notify(message) {
    this.notifications.push({ message, at: new Date() });
    this.notifications = this.notifications.slice(-6);
  }

  _renderSoon() {
    if (this._renderTimer) return;
    this._renderTimer = setTimeout(() => {
      this._renderTimer = null;
      this._render();
    }, 16);
  }

  _render() {
    this._renderHeader();
    this._renderTabs();
    this._renderSessions();
    this._renderTerminal();
    this._renderFileWarp();
    this._renderLower();
    this._renderFooter();
    this.screen.render();
  }

  _renderHeader() {
    const status = this.client.status;
    const color = statusColor(status);
    const count = this._activeSessionIds().length;
    const mode = this.mode === 'terminal' ? 'TERM' : this.mode.toUpperCase();
    this.header.setContent(
      `{bold} CLI PUNK {/bold} ` +
      `{${color}-fg}${status.toUpperCase()}{/} ` +
      `${count}/16  MODE ${mode}  PATH ${this.pathMode.toUpperCase()}  ${escapeTags(this.client.serverUrl)}`
    );
  }

  _renderTabs() {
    const sessions = [...this.sessions.values()];
    if (sessions.length === 0) {
      this.tabs.setContent(' {bold}NO SESSIONS{/bold}  Ctrl+N creates a Claude/Codex PTY session');
      return;
    }
    const parts = sessions.map((session) => {
      const meta = session.meta;
      const active = meta.id === this.activeSessionId;
      const label = escapeTags(meta.label || path.basename(meta.workDir || '') || meta.id.slice(0, 8));
      const key = session.hotkey || '-';
      const prefix = active ? `{${bauhaus.red}-fg}{bold}` : '';
      const suffix = active ? '{/bold}{/}' : '';
      return `${prefix}[${key}] ${label} ${meta.agentType || ''} ${meta.state || ''}${suffix}`;
    });
    this.tabs.setContent(` ${parts.join('   ')}`);
  }

  _renderSessions() {
    const lines = [...this.sessions.values()].map((session) => {
      const meta = session.meta;
      const selected = meta.id === this.activeSessionId;
      const stateMark = meta.state === 'active' ? 'ACT' : 'END';
      const label = escapeTags(meta.label || meta.id.slice(0, 8));
      const cwd = escapeTags(path.basename(meta.workDir || ''));
      const hotkey = session.hotkey || '-';
      const fg = selected ? bauhaus.red : bauhaus.text;
      return `{${fg}-fg}${selected ? '>' : ' '} ${hotkey} ${stateMark} ${label}{/}\n` +
        `    ${meta.agentType || 'unknown'}  ${cwd}\n` +
        `    files ${session.fileCount ?? 0}`;
    });
    this.sessionsPane.setContent(lines.length ? lines.join('\n\n') : ' No active sessions\n\n Ctrl+N new session');
  }

  _renderTerminal() {
    const active = this.sessions.get(this.activeSessionId);
    if (!active) {
      this.terminalPane.setContent('No active terminal. Press Ctrl+N to create a session.');
      return;
    }
    const metaLine = `${active.meta.label || active.meta.id}  ${active.meta.agentType || ''}  ${active.meta.workDir || ''}`;
    const body = active.terminalText || '(waiting for terminal.output / terminal.replay)';
    this.terminalPane.setLabel(` Terminal  ${escapeTags(metaLine)} `);
    this.terminalPane.setContent(body);
    this.terminalPane.setScrollPerc(100);
  }

  _renderFileWarp() {
    const active = this.sessions.get(this.activeSessionId);
    if (!active) {
      this.fileWarpPane.setContent('No session');
      return;
    }

    const rows = this._flatTree();
    const treeLines = rows.slice(0, Math.max(0, Number(this.fileWarpPane.height) - 10)).map((row, index) => {
      const selected = this.focusPane === 'files' && index === this.treeSelection;
      const icon = row.isDir ? (this.expandedPaths.has(row.path) ? 'v' : '>') : '-';
      const size = row.isDir ? '' : ` ${formatBytes(row.size)}`;
      const indent = ' '.repeat(row.depth * 2);
      const fg = selected ? bauhaus.red : row.isDir ? bauhaus.blue : bauhaus.text;
      return `{${fg}-fg}${selected ? '>' : ' '} ${indent}${icon} ${escapeTags(row.name)}${size}{/}`;
    });

    const commands = active.quickCommands || readQuickCommands(active.meta?.agentType);
    const cmdLines = commands.map((cmd, index) => {
      const key = String(index + 1);
      return `{${bauhaus.red}-fg}${key}{/} ${escapeTags(cmd.label)}  {${bauhaus.muted}-fg}${escapeTags(cmd.command)}{/}`;
    });

    this.fileWarpPane.setContent([
      `{bold}FILTER{/bold} ${escapeTags(this.treeFilter || '(none)')}`,
      `{bold}MODE{/bold} ${this.pathMode}  Enter inserts path`,
      '',
      ...treeLines,
      '',
      `{bold}QUICK CMDS{/bold}`,
      ...cmdLines,
    ].join('\n'));
  }

  _renderLower() {
    const active = this.sessions.get(this.activeSessionId);
    const activity = active?.activity || [];
    const activityLines = activity.slice(-4).map((event) => {
      const kind = escapeTags(event.kind || 'event');
      const text = escapeTags(event.text || event.toolName || event.input || event.error || '');
      return `{${bauhaus.blue}-fg}${kind}{/} ${text}`;
    });
    const noticeLines = this.notifications.slice(-4).map((notice) => {
      const time = notice.at.toLocaleTimeString();
      return `{${bauhaus.red}-fg}${time}{/} ${escapeTags(notice.message)}`;
    });
    this.lowerPane.setContent([
      ...activityLines,
      activityLines.length && noticeLines.length ? '' : null,
      ...noticeLines,
    ].filter(Boolean).join('\n') || 'No activity yet');
  }

  _renderFooter() {
    const label = this.mode === 'terminal'
      ? 'Ctrl+` command/close  Alt+a-z switch  reserved hotkeys stay out of PTY input'
      : 'Ctrl+` terminal  q quit  n new  r refresh  / filter  m path mode  arrows select  Enter insert';
    this.footer.setContent(` ${label}`);
  }
}

export async function runTui(options = {}) {
  const app = new TuiApp(options);
  await app.run();
}
