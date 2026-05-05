/**
 * Font Size Settings — manages adjustable font size offset.
 * Uses CSS custom property --fs-offset and localStorage for persistence.
 * Dispatches 'font-offset-changed' CustomEvent for Phaser/non-CSS consumers.
 */

const STORAGE_KEY = 'claudePunk_fontOffset';

export function getFontOffset() {
  return parseInt(localStorage.getItem(STORAGE_KEY) || '0', 10);
}

export function setFontOffset(offset) {
  localStorage.setItem(STORAGE_KEY, String(offset));
  document.documentElement.style.setProperty('--fs-offset', `${offset}px`);
  window.dispatchEvent(new CustomEvent('font-offset-changed', { detail: offset }));
}

/** Call once on startup to apply saved offset. */
export function initFontOffset() {
  const offset = getFontOffset();
  document.documentElement.style.setProperty('--fs-offset', `${offset}px`);
}
