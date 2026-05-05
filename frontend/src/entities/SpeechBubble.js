/**
 * SpeechBubble — pixel-art speech bubble above a character showing
 * a short summary of what the agent is currently doing.
 *
 * Uses Phaser Graphics for the bubble shape and Text for content.
 * Positioned relative to the character's hotkey label.
 */

import {
  BUBBLE_DISPLAY_TIME,
  BUBBLE_FADE_TIME,
  BUBBLE_MAX_CHARS,
  BUBBLE_DEBOUNCE,
  BUBBLE_OFFSET_Y,
  BUBBLE_COLORS,
} from '../config/bubbles.js';

// ANSI escape sequence stripper
const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?(?:\x07|\x1b\\)/g;
function stripAnsi(text) {
  return text.replace(ANSI_RE, '');
}

// Summary extraction patterns — checked from most recent line backwards
const SUMMARY_PATTERNS = [
  // Claude Code tool usage patterns
  { regex: /Read\s+(\S+)/i, format: (m) => `Reading ${basename(m[1]).slice(0, 11)}` },
  { regex: /Write\s+(\S+)/i, format: (m) => `Writing ${basename(m[1]).slice(0, 11)}` },
  { regex: /Edit\s+(\S+)/i, format: (m) => `Editing ${basename(m[1]).slice(0, 11)}` },
  { regex: /Bash\s*[:(]/i, format: () => 'Running cmd...' },
  { regex: /Glob\s/i, format: () => 'Searching...' },
  { regex: /Grep\s/i, format: () => 'Searching...' },
  { regex: /Task\s/i, format: () => 'Delegating...' },
  { regex: /thinking/i, format: () => 'Thinking...' },

  // Build / install / test patterns
  { regex: /installing\s+(.+)/i, format: (m) => `Installing ${m[1].slice(0, 10)}` },
  { regex: /running\s+(.+)/i, format: (m) => `Running ${m[1].slice(0, 12)}` },
  { regex: /error[:\s]+(.+)/i, format: (m) => `Error: ${m[1].slice(0, 12)}` },
  { regex: /warning[:\s]+(.+)/i, format: (m) => `Warn: ${m[1].slice(0, 13)}` },
  { regex: /compiling/i, format: () => 'Compiling...' },
  { regex: /building/i, format: () => 'Building...' },
  { regex: /bundling/i, format: () => 'Bundling...' },
  { regex: /linting/i, format: () => 'Linting...' },
  { regex: /formatting/i, format: () => 'Formatting...' },
  { regex: /(\d+)\s+(?:tests?\s+)?pass/i, format: (m) => `${m[1]} tests passed` },
  { regex: /(\d+)\s+(?:tests?\s+)?fail/i, format: (m) => `${m[1]} tests failed!` },
  { regex: /testing\s+(.+)/i, format: (m) => `Testing ${m[1].slice(0, 12)}` },

  // Git patterns
  { regex: /commit\s+([a-f0-9]{7})/i, format: (m) => `Committed ${m[1]}` },
  { regex: /push(?:ing|ed)?\s/i, format: () => 'Pushing...' },
  { regex: /pull(?:ing|ed)?\s/i, format: () => 'Pulling...' },
  { regex: /merg(?:ing|ed?)\s/i, format: () => 'Merging...' },
  { regex: /rebas(?:ing|ed?)\s/i, format: () => 'Rebasing...' },

  // File operations
  { regex: /created?\s+(.+\.\w+)/i, format: (m) => `Created ${basename(m[1]).slice(0, 11)}` },
  { regex: /delet(?:ing|ed?)\s+(.+)/i, format: (m) => `Deleting ${basename(m[1]).slice(0, 10)}` },
  { regex: /(?:npm|pnpm|yarn)\s+(install|run|build|test)/i, format: (m) => `npm ${m[1]}...` },

  // Broad fallback — pick up dollar-prompt commands
  { regex: /\$\s+(\S+)/i, format: (m) => `\$ ${m[1].slice(0, 16)}` },
];

function basename(filepath) {
  const parts = filepath.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || filepath;
}

/**
 * Extract a short summary from recent terminal output lines.
 * @param {string[]} lines - Recent output lines (newest last)
 * @returns {string|null}
 */
function extractSummary(lines) {
  for (let i = lines.length - 1; i >= 0; i--) {
    const stripped = stripAnsi(lines[i]).trim();
    if (!stripped) continue;
    for (const { regex, format } of SUMMARY_PATTERNS) {
      const match = stripped.match(regex);
      if (match) {
        const text = format(match);
        return text.length > BUBBLE_MAX_CHARS
          ? text.slice(0, BUBBLE_MAX_CHARS - 1) + '\u2026'
          : text;
      }
    }
  }
  return null;
}

export default class SpeechBubble {
  /**
   * @param {Phaser.Scene} scene
   * @param {import('./Character.js').default} character
   */
  constructor(scene, character) {
    this.scene = scene;
    this.character = character;
    this.text = '';
    this.visible = false;
    this.destroyed = false;

    // Output line buffer (keep last 10 lines)
    this.lineBuffer = [];
    this.partialLine = '';

    // Debounce timer
    this.debounceTimer = null;
    this.lastSummary = null;

    // Fade timers
    this.displayTimer = null;
    this.fadeTimer = null;

    // Create Phaser objects
    this.container = scene.add.container(0, 0);
    this.container.setDepth(14);
    this.container.setAlpha(0);

    // Bubble background (Graphics)
    this.bg = scene.add.graphics();
    this.container.add(this.bg);

    // Bubble text
    this.label = scene.add.text(0, 0, '', {
      fontSize: '18px',
      fontFamily: 'Rajdhani, sans-serif',
      color: BUBBLE_COLORS.text,
      stroke: '#0a0a14',
      strokeThickness: 2,
    });
    this.label.setOrigin(0.5, 0.5);
    this.container.add(this.label);

    // Typing indicator
    this.typingDots = '';
    this.typingTimer = null;

    this.updatePosition();
  }

  /** Reposition bubble above the character sprite. */
  updatePosition() {
    if (this.destroyed) return;
    const sprite = this.character.sprite;
    if (sprite) {
      // sprite origin is (0.5, 1) so top of head ≈ sprite.y - displayHeight
      const headY = sprite.y - sprite.displayHeight;
      this.container.setPosition(sprite.x, headY + BUBBLE_OFFSET_Y);
    }
  }

  /** Redraw the bubble background to fit current text. */
  redrawBg() {
    this.bg.clear();
    const w = Math.max(this.label.width + 20, 40);
    const h = this.label.height + 12;
    const x = -w / 2;
    const y = -h / 2;

    // Background fill
    this.bg.fillStyle(BUBBLE_COLORS.bg, 0.9);
    this.bg.fillRoundedRect(x, y, w, h, 4);

    // Border
    this.bg.lineStyle(1, BUBBLE_COLORS.border, 0.8);
    this.bg.strokeRoundedRect(x, y, w, h, 4);

    // Triangle pointer at bottom center
    const triW = 6;
    const triH = 6;
    this.bg.fillStyle(BUBBLE_COLORS.bg, 0.9);
    this.bg.fillTriangle(
      -triW, h / 2,
      triW, h / 2,
      0, h / 2 + triH,
    );
    // Triangle border lines
    this.bg.lineStyle(1, BUBBLE_COLORS.border, 0.8);
    this.bg.lineBetween(-triW, h / 2, 0, h / 2 + triH);
    this.bg.lineBetween(triW, h / 2, 0, h / 2 + triH);
  }

  /**
   * Process raw terminal output data for this character's session.
   * Buffers lines and extracts summaries with debouncing.
   * @param {string} data - Raw PTY output chunk
   */
  onTerminalOutput(data) {
    if (this.destroyed) return;

    // Accumulate into line buffer
    const text = this.partialLine + data;
    const lines = text.split(/\r?\n/);
    this.partialLine = lines.pop() || '';

    for (const line of lines) {
      const clean = stripAnsi(line).trim();
      if (clean) {
        this.lineBuffer.push(clean);
        if (this.lineBuffer.length > 10) this.lineBuffer.shift();
      }
    }

    // Reset display/fade timers on any output
    this.resetFadeTimers();

    // Debounce summary extraction
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.updateSummary();
    }, BUBBLE_DEBOUNCE);
  }

  /** Extract and display summary from buffered lines. */
  updateSummary() {
    if (this.destroyed) return;

    const summary = extractSummary(this.lineBuffer);
    if (summary && summary !== this.lastSummary) {
      this.lastSummary = summary;
      this.stopTyping();
      this.setText(summary);
      this.show();
    } else if (!summary) {
      // No pattern match but we have output — show typing indicator
      this.showTyping();
    }
  }

  /** Set the bubble text content. */
  setText(text) {
    if (this.destroyed) return;
    this.text = text;
    this.label.setText(text);
    this.redrawBg();
    this.updatePosition();
  }

  /** Show the typing indicator (animated dots). */
  showTyping() {
    if (this.destroyed || this.typingTimer) return;
    this.typingDots = '.';
    this.setText(this.typingDots);
    this.show();

    this.typingTimer = this.scene.time.addEvent({
      delay: 400,
      loop: true,
      callback: () => {
        if (this.destroyed) return;
        this.typingDots = this.typingDots.length >= 3 ? '.' : this.typingDots + '.';
        this.label.setText(this.typingDots);
        this.redrawBg();
      },
    });
  }

  /** Stop the typing indicator. */
  stopTyping() {
    if (this.typingTimer) {
      this.typingTimer.remove();
      this.typingTimer = null;
    }
  }

  /** Fade in the bubble. */
  show() {
    if (this.destroyed || this.visible) return;
    this.visible = true;
    this.updatePosition();
    this.scene.tweens.add({
      targets: this.container,
      alpha: 1,
      duration: 200,
      ease: 'Power1',
    });
  }

  /** Start fading the bubble. */
  fadeOut() {
    if (this.destroyed || !this.visible) return;
    this.scene.tweens.add({
      targets: this.container,
      alpha: 0.5,
      duration: 300,
      ease: 'Power1',
    });
  }

  /** Fully hide the bubble. */
  hide() {
    if (this.destroyed) return;
    this.visible = false;
    this.stopTyping();
    this.scene.tweens.add({
      targets: this.container,
      alpha: 0,
      duration: 300,
      ease: 'Power1',
    });
  }

  /** Reset the display/fade timeout chain. */
  resetFadeTimers() {
    if (this.displayTimer) {
      clearTimeout(this.displayTimer);
      this.displayTimer = null;
    }
    if (this.fadeTimer) {
      clearTimeout(this.fadeTimer);
      this.fadeTimer = null;
    }

    // If visible, restore full opacity
    if (this.visible && this.container.alpha < 1) {
      this.scene.tweens.add({
        targets: this.container,
        alpha: 1,
        duration: 150,
      });
    }

    // After DISPLAY_TIME with no output, start fading
    this.displayTimer = setTimeout(() => {
      if (!this.destroyed) this.fadeOut();

      // After additional time, fully hide
      this.fadeTimer = setTimeout(() => {
        if (!this.destroyed) this.hide();
      }, BUBBLE_FADE_TIME - BUBBLE_DISPLAY_TIME);
    }, BUBBLE_DISPLAY_TIME);
  }

  /** Clean up everything. */
  destroy() {
    this.destroyed = true;
    this.stopTyping();
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.displayTimer) clearTimeout(this.displayTimer);
    if (this.fadeTimer) clearTimeout(this.fadeTimer);
    this.container.destroy();
  }
}
