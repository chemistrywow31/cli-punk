/**
 * CostDisplay — small neon price tag floating near a character's drink area.
 * Shows estimated cost in USD with a color that shifts green → amber → red.
 */

import costTracker from '../services/costTracker.js';

// Cost thresholds for color changes
const COLOR_GREEN = '#40c080';
const COLOR_AMBER = '#ffaa00';
const COLOR_RED = '#ff0080';

function costColor(cost) {
  if (cost < 1) return COLOR_GREEN;
  if (cost < 5) return COLOR_AMBER;
  return COLOR_RED;
}

export default class CostDisplay {
  /**
   * @param {Phaser.Scene} scene
   * @param {string} sessionId
   * @param {{ x: number, y: number }} drinkAnchor
   */
  constructor(scene, sessionId, drinkAnchor) {
    this.scene = scene;
    this.sessionId = sessionId;
    this.destroyed = false;

    // Position near the drink area, offset upward
    const x = drinkAnchor.x;
    const y = drinkAnchor.y - 30;

    this.label = scene.add.text(x, y, '$0.00', {
      fontSize: '16px',
      fontFamily: 'JetBrains Mono, monospace',
      color: COLOR_GREEN,
      stroke: '#0a0a14',
      strokeThickness: 4,
    });
    this.label.setOrigin(0.5, 1);
    this.label.setDepth(9);
    this.label.setAlpha(0);

    // Subscribe to cost updates
    this.unsub = costTracker.onChange((changedSessionId) => {
      if (changedSessionId === this.sessionId) this.update();
    });
  }

  /** Update the display with current cost data. */
  update() {
    if (this.destroyed) return;

    const data = costTracker.getSessionCost(this.sessionId);
    if (!data) return;

    const costStr = costTracker.formatCost(data.cost);
    this.label.setText(costStr);
    this.label.setColor(costColor(data.cost));

    // Show on first non-zero cost
    if (data.cost > 0 && this.label.alpha === 0) {
      this.scene.tweens.add({
        targets: this.label,
        alpha: 0.85,
        duration: 400,
        ease: 'Power1',
      });
    }
  }

  destroy() {
    this.destroyed = true;
    if (this.unsub) this.unsub();
    if (this.label) this.label.destroy();
  }
}
