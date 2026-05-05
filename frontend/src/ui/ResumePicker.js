/**
 * Resume Picker overlay — lists previous Claude Code conversations
 * and lets the user pick one to resume.
 */

import wsService from '../services/websocket.js';

const STORAGE_KEY = 'claude-punk-recent-folders';

export default class ResumePicker {
  constructor() {
    this.overlay = document.getElementById('resume-picker-overlay');
    this.onShow = null;
    this.onHide = null;
    this.visible = false;
    this._unsubConversations = null;
    this._selectedDir = '';
    this.init();
  }

  init() {
    this.overlay.innerHTML = `
      <div class="resume-picker-panel cyberpunk-panel">
        <div class="rp-header">
          <span class="rp-title">RESUME CONVERSATION</span>
          <button class="rp-close">&times;</button>
        </div>
        <div class="rp-body">
          <div class="rp-dir-section">
            <div class="rp-section-label">PROJECT DIRECTORY</div>
            <div class="rp-dir-list"></div>
          </div>
          <div class="rp-conv-section hidden">
            <div class="rp-section-label">CONVERSATIONS <span class="rp-dir-name"></span></div>
            <div class="rp-conv-loading hidden">Loading...</div>
            <div class="rp-conv-list"></div>
            <div class="rp-conv-empty hidden">No conversations found.</div>
          </div>
        </div>
      </div>
    `;

    this.overlay.querySelector('.rp-close').addEventListener('click', () => this.hide());
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.hide();
    });
  }

  show() {
    this.overlay.classList.remove('hidden');
    this.visible = true;
    if (this.onShow) this.onShow();

    this._unsubConversations = wsService.on('claude.conversations', (payload) => {
      this._renderConversations(payload.conversations || []);
    });

    this._renderDirList();
    // Hide conversation section until a dir is selected
    this.overlay.querySelector('.rp-conv-section').classList.add('hidden');
  }

  hide() {
    this.overlay.classList.add('hidden');
    this.visible = false;
    if (this._unsubConversations) {
      this._unsubConversations();
      this._unsubConversations = null;
    }
    if (this.onHide) this.onHide();
  }

  _getRecentFolders() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }

  _renderDirList() {
    const list = this.overlay.querySelector('.rp-dir-list');
    list.innerHTML = '';
    const recent = this._getRecentFolders();

    if (recent.length === 0) {
      list.innerHTML = '<div class="rp-empty">No recent directories. Open a session first.</div>';
      return;
    }

    for (const item of recent) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'rp-dir-item';
      btn.innerHTML = `
        <span class="rp-dir-label">${this._escHtml(item.label || item.path.split('/').pop())}</span>
        <span class="rp-dir-path">${this._escHtml(item.path)}</span>
      `;
      btn.addEventListener('click', () => this._selectDir(item.path));
      list.appendChild(btn);
    }
  }

  _selectDir(workDir) {
    this._selectedDir = workDir;
    const convSection = this.overlay.querySelector('.rp-conv-section');
    convSection.classList.remove('hidden');
    this.overlay.querySelector('.rp-dir-name').textContent = workDir.split('/').pop();
    this.overlay.querySelector('.rp-conv-list').innerHTML = '';
    this.overlay.querySelector('.rp-conv-empty').classList.add('hidden');
    this.overlay.querySelector('.rp-conv-loading').classList.remove('hidden');

    // Highlight selected dir
    for (const el of this.overlay.querySelectorAll('.rp-dir-item')) {
      el.classList.remove('active');
    }
    const items = this.overlay.querySelectorAll('.rp-dir-item');
    const recent = this._getRecentFolders();
    for (let i = 0; i < recent.length; i++) {
      if (recent[i].path === workDir && items[i]) {
        items[i].classList.add('active');
      }
    }

    wsService.listConversations(workDir);
  }

  _renderConversations(conversations) {
    const list = this.overlay.querySelector('.rp-conv-list');
    const empty = this.overlay.querySelector('.rp-conv-empty');
    const loading = this.overlay.querySelector('.rp-conv-loading');
    loading.classList.add('hidden');
    list.innerHTML = '';

    if (conversations.length === 0) {
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');

    for (const conv of conversations) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'rp-conv-item';

      const lastActive = new Date(conv.lastActiveAt);
      const timeStr = this._formatRelativeTime(lastActive);
      const sizeStr = conv.sizeBytes > 1024 * 1024
        ? (conv.sizeBytes / (1024 * 1024)).toFixed(1) + ' MB'
        : Math.round(conv.sizeBytes / 1024) + ' KB';

      el.innerHTML = `
        <div class="rp-conv-header">
          <span class="rp-conv-time">${this._escHtml(timeStr)}</span>
          <span class="rp-conv-size">${sizeStr}</span>
        </div>
        <div class="rp-conv-text">${this._escHtml(conv.firstUserText)}</div>
      `;

      el.addEventListener('click', () => this._resumeConversation(conv.sessionId));
      list.appendChild(el);
    }
  }

  _resumeConversation(claudeSessionId) {
    const workDir = this._selectedDir;
    if (!workDir) return;

    const label = workDir.split('/').pop() || 'session';
    const sent = wsService.createSession(workDir, label, 'claude', claudeSessionId);
    if (sent) {
      this.hide();
    }
  }

  _formatRelativeTime(date) {
    const now = Date.now();
    const diff = now - date.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  _escHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}
