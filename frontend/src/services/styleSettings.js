const PAGE_STYLE_KEY = 'claudePunk_pageStyle';
const TERMINAL_STYLE_KEY = 'claudePunk_terminalStyle';

export const PAGE_STYLES = [
  { id: 'workbench', label: 'Workbench', description: 'Warm paper, black lines, red and blue controls.' },
  { id: 'night', label: 'Night Ops', description: 'Charcoal panels with teal, amber, and rust accents.' },
  { id: 'contrast', label: 'Contrast', description: 'White, black, cobalt, and red for maximum separation.' },
];

export const TERMINAL_STYLES = [
  { id: 'punk', label: 'Punk Dark', description: 'Current dark terminal with cyan and amber highlights.' },
  { id: 'paper', label: 'Paper Mono', description: 'Light terminal for reading long output.' },
  { id: 'amber', label: 'Amber CRT', description: 'Warm amber foreground on black.' },
  { id: 'green', label: 'Green Phosphor', description: 'Classic green foreground on deep black.' },
];

const XTERM_THEMES = {
  punk: {
    background: '#0a0a14',
    foreground: '#e0e0e0',
    cursor: '#00f0ff',
    cursorAccent: '#0a0a14',
    selectionBackground: '#00f0ff44',
    black: '#0a0a14',
    red: '#ff5c8a',
    green: '#46d68c',
    yellow: '#ffaa00',
    blue: '#6a8dff',
    magenta: '#d46bff',
    cyan: '#00d5df',
    white: '#e0e0e0',
    brightBlack: '#5f6078',
    brightRed: '#ff7aa2',
    brightGreen: '#68e3a3',
    brightYellow: '#ffcc44',
    brightBlue: '#8ba6ff',
    brightMagenta: '#e098ff',
    brightCyan: '#44ffff',
    brightWhite: '#ffffff',
  },
  paper: {
    background: '#fbf7e8',
    foreground: '#151515',
    cursor: '#c43d2b',
    cursorAccent: '#fbf7e8',
    selectionBackground: '#0057b833',
    black: '#151515',
    red: '#b3261e',
    green: '#127a4a',
    yellow: '#9a6700',
    blue: '#0057b8',
    magenta: '#8750a0',
    cyan: '#006c70',
    white: '#f5f0df',
    brightBlack: '#6b6a60',
    brightRed: '#d84b3a',
    brightGreen: '#1d9960',
    brightYellow: '#c08200',
    brightBlue: '#1b6fd0',
    brightMagenta: '#a96bc0',
    brightCyan: '#008f8f',
    brightWhite: '#ffffff',
  },
  amber: {
    background: '#0d0904',
    foreground: '#ffcf70',
    cursor: '#ffd98f',
    cursorAccent: '#0d0904',
    selectionBackground: '#ffb13b44',
    black: '#0d0904',
    red: '#ff6b4a',
    green: '#d6b45e',
    yellow: '#ffb13b',
    blue: '#d48a38',
    magenta: '#e68c5c',
    cyan: '#d6a95a',
    white: '#ffdf9d',
    brightBlack: '#8a6840',
    brightRed: '#ff8b6c',
    brightGreen: '#edd082',
    brightYellow: '#ffd37a',
    brightBlue: '#e6a75b',
    brightMagenta: '#ffad7d',
    brightCyan: '#f0bf6e',
    brightWhite: '#fff3d8',
  },
  green: {
    background: '#061008',
    foreground: '#9cffb1',
    cursor: '#b7ffc6',
    cursorAccent: '#061008',
    selectionBackground: '#66ff8840',
    black: '#061008',
    red: '#ff6b6b',
    green: '#66ff88',
    yellow: '#c9e86f',
    blue: '#62c6ff',
    magenta: '#d184ff',
    cyan: '#6fffe0',
    white: '#d7ffe0',
    brightBlack: '#4a7854',
    brightRed: '#ff8585',
    brightGreen: '#9cffb1',
    brightYellow: '#e4ff91',
    brightBlue: '#8fd8ff',
    brightMagenta: '#e0a5ff',
    brightCyan: '#9dffec',
    brightWhite: '#ffffff',
  },
};

export function initStyleSettings() {
  applyPageStyle(getPageStyle());
  applyTerminalStyle(getTerminalStyle());
}

export function getPageStyle() {
  return normalizeStyle(localStorage.getItem(PAGE_STYLE_KEY), PAGE_STYLES, 'workbench');
}

export function setPageStyle(styleId) {
  const normalized = normalizeStyle(styleId, PAGE_STYLES, 'workbench');
  localStorage.setItem(PAGE_STYLE_KEY, normalized);
  applyPageStyle(normalized);
  window.dispatchEvent(new CustomEvent('page-style-changed', { detail: normalized }));
}

export function getTerminalStyle() {
  return normalizeStyle(localStorage.getItem(TERMINAL_STYLE_KEY), TERMINAL_STYLES, 'punk');
}

export function setTerminalStyle(styleId) {
  const normalized = normalizeStyle(styleId, TERMINAL_STYLES, 'punk');
  localStorage.setItem(TERMINAL_STYLE_KEY, normalized);
  applyTerminalStyle(normalized);
  window.dispatchEvent(new CustomEvent('terminal-style-changed', { detail: normalized }));
}

export function getTerminalTheme(styleId = getTerminalStyle()) {
  return XTERM_THEMES[styleId] || XTERM_THEMES.punk;
}

function applyPageStyle(styleId) {
  document.body.dataset.pageStyle = styleId;
}

function applyTerminalStyle(styleId) {
  document.body.dataset.terminalStyle = styleId;
}

function normalizeStyle(styleId, styles, fallback) {
  return styles.some((style) => style.id === styleId) ? styleId : fallback;
}
