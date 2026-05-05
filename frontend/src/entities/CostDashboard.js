/**
 * CostDashboard — in-game "bar tab" menu board displayed near the bartender.
 * Shows each agent's hotkey, token count, and cost at a glance.
 *
 * Layout (up to 10 rows):
 * ╭──────────────────────╮
 * │     BAR TAB          │
 * │──────────────────────│
 * │ (a) 12.4K    $2.40  │
 * │ (b)  8.2K    $1.80  │
 * │ (c)  3.1K    $0.60  │
 * │                      │
 * │──────────────────────│
 * │ TOTAL        $4.80   │
 * ╰──────────────────────╯
 */

import costTracker from '../services/costTracker.js';

// Panel layout constants
const PANEL_W = 240;
const PAD_X = 14;
const PAD_Y = 10;
const TITLE_H = 28;
const SEP_H = 1;
const ROW_H = 22;
const MAX_ROWS = 10;
const TOTAL_H = 26;
const PANEL_H = PAD_Y + TITLE_H + SEP_H + ROW_H * MAX_ROWS + SEP_H + TOTAL_H + PAD_Y;

// Colors
const BG_COLOR = 0x1a1a2e;
const BG_ALPHA = 0.88;
const BORDER_COLOR = 0x00f0ff;
const BORDER_ALPHA = 0.6;
const SEP_COLOR = 0x00f0ff;
const SEP_ALPHA = 0.2;

const FONT_MONO = 'JetBrains Mono, monospace';
const FONT_UI = 'Rajdhani, sans-serif';

export default class CostDashboard {
  /**
   * @param {Phaser.Scene} scene
   * @param {number} x - Top-left X
   * @param {number} y - Top-left Y
   * @param {Map} patrons - Reference to BarScene.patrons map
   */
  constructor(scene, x, y, patrons) {
    this.scene = scene;
    this.x = x;
    this.y = y;
    this.patrons = patrons;
    this.destroyed = false;

    // Container for all dashboard objects
    this.container = scene.add.container(x, y);
    this.container.setDepth(15);

    // Draw the panel frame
    this.bg = scene.add.graphics();
    this.drawFrame();
    this.container.add(this.bg);

    // Title text
    this.titleText = scene.add.text(PANEL_W / 2, PAD_Y + TITLE_H / 2, 'BAR TAB', {
      fontSize: '17px',
      fontFamily: FONT_UI,
      fontStyle: 'bold',
      color: '#00f0ff',
      stroke: '#0a0a14',
      strokeThickness: 2,
    });
    this.titleText.setOrigin(0.5, 0.5);
    this.container.add(this.titleText);

    // Row text objects (pre-create 10 for hotkey+tokens and cost)
    this.rowLabels = [];
    this.rowCosts = [];
    this.rowHitZones = [];
    this.rowSessionIds = new Array(MAX_ROWS).fill(null);
    this.rowHighlight = scene.add.graphics();
    this.container.add(this.rowHighlight);
    const rowStartY = PAD_Y + TITLE_H + SEP_H;

    for (let i = 0; i < MAX_ROWS; i++) {
      const ry = rowStartY + i * ROW_H + ROW_H / 2;

      // Invisible hit zone spanning the full row
      const zone = scene.add.zone(PANEL_W / 2, ry, PANEL_W - 2, ROW_H)
        .setOrigin(0.5, 0.5)
        .setInteractive({ useHandCursor: true });

      zone.on('pointerover', () => {
        if (!this.rowSessionIds[i]) return;
        this.rowHighlight.clear();
        this.rowHighlight.fillStyle(0x00f0ff, 0.08);
        this.rowHighlight.fillRect(1, rowStartY + i * ROW_H, PANEL_W - 2, ROW_H);
      });
      zone.on('pointerout', () => {
        this.rowHighlight.clear();
      });
      zone.on('pointerdown', () => {
        const sessionId = this.rowSessionIds[i];
        if (!sessionId) return;
        scene.events.emit('character-clicked', { sessionId });
      });

      this.rowHitZones.push(zone);
      this.container.add(zone);

      const label = scene.add.text(PAD_X, ry, '', {
        fontSize: '14px',
        fontFamily: FONT_MONO,
        color: '#8888aa',
      });
      label.setOrigin(0, 0.5);

      const cost = scene.add.text(PANEL_W - PAD_X, ry, '', {
        fontSize: '14px',
        fontFamily: FONT_MONO,
        color: '#8888aa',
      });
      cost.setOrigin(1, 0.5);

      this.rowLabels.push(label);
      this.rowCosts.push(cost);
      this.container.add(label);
      this.container.add(cost);
    }

    // Total row
    const totalY = rowStartY + MAX_ROWS * ROW_H + SEP_H + TOTAL_H / 2;
    this.totalLabel = scene.add.text(PAD_X, totalY, 'TOTAL', {
      fontSize: '15px',
      fontFamily: FONT_UI,
      fontStyle: 'bold',
      color: '#ffaa00',
    });
    this.totalLabel.setOrigin(0, 0.5);
    this.container.add(this.totalLabel);

    this.totalCost = scene.add.text(PANEL_W - PAD_X, totalY, '$0.00', {
      fontSize: '15px',
      fontFamily: FONT_MONO,
      fontStyle: 'bold',
      color: '#ffaa00',
    });
    this.totalCost.setOrigin(1, 0.5);
    this.container.add(this.totalCost);

    // Subscribe to cost changes
    this.unsub = costTracker.onChange(() => this.refresh());

    // Periodic sync every 3s as safety net (catches patron add/remove races)
    this.syncInterval = setInterval(() => this.refresh(), 3000);

    // Initial render
    this.refresh();
  }

  drawFrame() {
    const g = this.bg;
    g.clear();

    // Hollow background
    g.fillStyle(BG_COLOR, BG_ALPHA);
    g.fillRoundedRect(0, 0, PANEL_W, PANEL_H, 4);

    // Border
    g.lineStyle(1, BORDER_COLOR, BORDER_ALPHA);
    g.strokeRoundedRect(0, 0, PANEL_W, PANEL_H, 4);

    // Corner accents (2px neon marks at corners)
    const acc = 8;
    g.lineStyle(2, BORDER_COLOR, 0.9);
    // Top-left
    g.lineBetween(1, 1, 1, 1 + acc);
    g.lineBetween(1, 1, 1 + acc, 1);
    // Top-right
    g.lineBetween(PANEL_W - 1, 1, PANEL_W - 1, 1 + acc);
    g.lineBetween(PANEL_W - 1, 1, PANEL_W - 1 - acc, 1);
    // Bottom-left
    g.lineBetween(1, PANEL_H - 1, 1, PANEL_H - 1 - acc);
    g.lineBetween(1, PANEL_H - 1, 1 + acc, PANEL_H - 1);
    // Bottom-right
    g.lineBetween(PANEL_W - 1, PANEL_H - 1, PANEL_W - 1, PANEL_H - 1 - acc);
    g.lineBetween(PANEL_W - 1, PANEL_H - 1, PANEL_W - 1 - acc, PANEL_H - 1);

    // Separator under title
    const sep1Y = PAD_Y + TITLE_H;
    g.lineStyle(1, SEP_COLOR, SEP_ALPHA);
    g.lineBetween(PAD_X, sep1Y, PANEL_W - PAD_X, sep1Y);

    // Separator above total
    const sep2Y = PAD_Y + TITLE_H + SEP_H + MAX_ROWS * ROW_H;
    g.lineBetween(PAD_X, sep2Y, PANEL_W - PAD_X, sep2Y);
  }

  /** Refresh all rows from current patron/cost data. */
  refresh() {
    if (this.destroyed) return;

    // Gather active sessions with their hotkeys
    const entries = [];
    for (const [sessionId, patron] of this.patrons) {
      const char = patron.character;
      const data = costTracker.getSessionCost(sessionId);
      if (!data) continue;
      entries.push({
        sessionId,
        hotkey: char.hotkey || '?',
        tokens: data.inputTokens + data.outputTokens,
        cost: data.cost,
      });
    }

    // Sort by hotkey letter
    entries.sort((a, b) => a.hotkey.localeCompare(b.hotkey));

    // Update rows
    let totalCost = 0;
    for (let i = 0; i < MAX_ROWS; i++) {
      if (i < entries.length) {
        const e = entries[i];
        totalCost += e.cost;
        this.rowSessionIds[i] = e.sessionId;
        const tokenStr = costTracker.formatTokens(e.tokens);
        this.rowLabels[i].setText(`(${e.hotkey}) ${tokenStr}`);
        this.rowLabels[i].setColor('#e0e0e0');
        this.rowCosts[i].setText(costTracker.formatCost(e.cost));
        this.rowCosts[i].setColor(this.costColor(e.cost));
      } else {
        this.rowSessionIds[i] = null;
        this.rowLabels[i].setText('');
        this.rowCosts[i].setText('');
      }
    }

    this.totalCost.setText(costTracker.formatCost(totalCost));
  }

  costColor(cost) {
    if (cost < 1) return '#40c080';
    if (cost < 5) return '#ffaa00';
    return '#ff0080';
  }

  destroy() {
    this.destroyed = true;
    if (this.unsub) this.unsub();
    if (this.syncInterval) clearInterval(this.syncInterval);
    this.container.destroy();
  }
}
