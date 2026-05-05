import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_SERVER_URL = 'http://127.0.0.1:3000';
export const CONFIG_DIR = path.join(os.homedir(), '.claude-punk');
export const CLIENT_CONFIG_PATH = path.join(CONFIG_DIR, 'client.json');
export const RECENT_FOLDERS_PATH = path.join(CONFIG_DIR, 'recent-folders.json');
export const QUICK_COMMANDS_PATH = path.join(CONFIG_DIR, 'quick-commands.json');

export function ensureConfigDir() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
}

export function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJsonFile(filePath, value, mode = 0o600) {
  ensureConfigDir();
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode });
  try {
    fs.chmodSync(filePath, mode);
  } catch {
    // Best effort on platforms with different permission semantics.
  }
}

export function readClientConfig() {
  return readJsonFile(CLIENT_CONFIG_PATH, {});
}

export function writeClientConfig(config) {
  writeJsonFile(CLIENT_CONFIG_PATH, config, 0o600);
}

export function resolveServerUrl(options = {}) {
  const config = readClientConfig();
  const raw = options.server || process.env.CLAUDE_PUNK_SERVER || config.serverUrl || DEFAULT_SERVER_URL;
  return normalizeServerUrl(raw);
}

export function resolveToken(options = {}) {
  const config = readClientConfig();
  return options.token || process.env.CLAUDE_PUNK_TOKEN || config.token || null;
}

export function normalizeServerUrl(raw) {
  const url = new URL(raw);
  url.hash = '';
  url.search = '';
  return url.toString().replace(/\/$/, '');
}

export function readRecentFolders() {
  const folders = readJsonFile(RECENT_FOLDERS_PATH, []);
  return Array.isArray(folders) ? folders.filter((item) => typeof item === 'string') : [];
}

export function rememberFolder(workDir) {
  const resolved = path.resolve(workDir);
  const existing = readRecentFolders().filter((item) => item !== resolved);
  writeJsonFile(RECENT_FOLDERS_PATH, [resolved, ...existing].slice(0, 10), 0o600);
}

const DEFAULT_QUICK_COMMANDS = {
  claude: [
    { label: '/cost', command: '/cost' },
    { label: '/compact', command: '/compact' },
  ],
  codex: [
    { label: '/help', command: '/help' },
  ],
};

export function readQuickCommands(agentType = 'claude') {
  const config = readJsonFile(QUICK_COMMANDS_PATH, {});
  const commands = config[agentType];
  if (Array.isArray(commands) && commands.length > 0) return commands;
  return DEFAULT_QUICK_COMMANDS[agentType] || [];
}

export function writeQuickCommands(agentType, commands) {
  const config = readJsonFile(QUICK_COMMANDS_PATH, {});
  config[agentType] = commands;
  writeJsonFile(QUICK_COMMANDS_PATH, config, 0o600);
}
