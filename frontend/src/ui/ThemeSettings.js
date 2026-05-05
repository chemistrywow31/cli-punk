/**
 * Display settings overlay.
 */

import { getFontOffset, setFontOffset } from '../services/fontSettings.js';
import {
  PAGE_STYLES,
  TERMINAL_STYLES,
  getPageStyle,
  getTerminalStyle,
  setPageStyle,
  setTerminalStyle,
} from '../services/styleSettings.js';

export default class ThemeSettings {
  constructor() {
    this.overlay = document.getElementById('theme-settings-overlay');
    this.visible = false;
    this.onShow = null;
    this.onHide = null;
    this.init();
  }

  init() {
    this.overlay.innerHTML = `
      <div class="theme-settings-panel cyberpunk-panel">
        <div class="ts-header">
          <span class="ts-title">STYLE</span>
          <button class="ts-close">&times;</button>
        </div>
        <div class="ts-body">
          <div class="ts-content">
            <div class="ts-tab-panel active" data-tab="display">
              <div class="ts-section-label">PAGE STYLE</div>
              <div class="ts-style-grid ts-page-style-list"></div>

              <div class="ts-section-label">TERMINAL STYLE</div>
              <div class="ts-style-grid ts-terminal-style-list"></div>

              <div class="ts-section-label">FONT SIZE</div>
              <div class="ts-font-control">
                <button class="ts-font-btn ts-font-minus" title="Decrease font size">\u2212</button>
                <span class="ts-font-value">0px</span>
                <button class="ts-font-btn ts-font-plus" title="Increase font size">+</button>
                <button class="ts-font-btn ts-font-reset" title="Reset to default">RESET</button>
              </div>
              <div class="ts-font-hint">Adjusts font sizes across dialog and activity panels.</div>
            </div>
          </div>
        </div>
      </div>
    `;

    this.overlay.querySelector('.ts-close').addEventListener('click', () => this.hide());
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.hide();
    });

    this._renderStyleOptions();

    // Font size controls
    this._fontValueEl = this.overlay.querySelector('.ts-font-value');
    this._updateFontDisplay();

    this.overlay.querySelector('.ts-font-minus').addEventListener('click', () => {
      const offset = getFontOffset();
      if (offset > -5) { setFontOffset(offset - 1); this._updateFontDisplay(); }
    });
    this.overlay.querySelector('.ts-font-plus').addEventListener('click', () => {
      const offset = getFontOffset();
      if (offset < 10) { setFontOffset(offset + 1); this._updateFontDisplay(); }
    });
    this.overlay.querySelector('.ts-font-reset').addEventListener('click', () => {
      setFontOffset(0); this._updateFontDisplay();
    });
  }

  show() {
    this.overlay.classList.remove('hidden');
    this.visible = true;
    this._renderStyleOptions();
    if (this.onShow) this.onShow();
  }

  hide() {
    this.overlay.classList.add('hidden');
    this.visible = false;
    if (this.onHide) this.onHide();
  }

  _updateFontDisplay() {
    if (!this._fontValueEl) return;
    const offset = getFontOffset();
    this._fontValueEl.textContent = offset >= 0 ? `+${offset}px` : `${offset}px`;
  }

  toggle() {
    if (this.visible) this.hide();
    else this.show();
  }

  _renderStyleOptions() {
    this._renderStyleGroup({
      container: this.overlay.querySelector('.ts-page-style-list'),
      styles: PAGE_STYLES,
      active: getPageStyle(),
      onSelect: setPageStyle,
    });
    this._renderStyleGroup({
      container: this.overlay.querySelector('.ts-terminal-style-list'),
      styles: TERMINAL_STYLES,
      active: getTerminalStyle(),
      onSelect: setTerminalStyle,
    });
  }

  _renderStyleGroup({ container, styles, active, onSelect }) {
    if (!container) return;
    container.innerHTML = '';
    for (const style of styles) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `ts-style-option${style.id === active ? ' active' : ''}`;
      button.dataset.styleId = style.id;
      button.innerHTML = `
        <span class="ts-style-name">${style.label}</span>
        <span class="ts-style-desc">${style.description}</span>
      `;
      button.addEventListener('click', () => {
        onSelect(style.id);
        this._renderStyleOptions();
      });
      container.appendChild(button);
    }
  }
}
