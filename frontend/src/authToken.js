const AUTH_ENV_KEYS = Object.freeze([
  'CLAUDE_PUNK_ADMIN_TOKEN',
  'CLAUDE_PUNK_AUTH_KEY',
  'CLAUDE_PUNK_DEV_TOKEN',
]);

export function parseAuthTokenInput(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const dotenvValues = parseDotenvContent(raw);
  for (const key of AUTH_ENV_KEYS) {
    if (dotenvValues[key]) return dotenvValues[key];
  }

  const collapsedToken = parseCollapsedDotenvToken(raw);
  if (collapsedToken) return collapsedToken;

  const bearerMatch = /^Bearer\s+(.+)$/i.exec(raw);
  if (bearerMatch?.[1]) return stripWrappingQuotes(stripInlineComment(bearerMatch[1].trim()));

  return stripWrappingQuotes(raw);
}

function parseDotenvContent(content) {
  const values = {};
  for (const rawLine of String(content || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    values[key] = parseDotenvValue(rawValue);
  }
  return values;
}

function parseCollapsedDotenvToken(raw) {
  for (const key of AUTH_ENV_KEYS) {
    const match = new RegExp(`(?:^|[\\s;])(?:export\\s+)?${key}\\s*=\\s*`, 'i').exec(raw);
    if (!match) continue;

    const valueStart = match.index + match[0].length;
    const parsed = readCollapsedValue(raw.slice(valueStart));
    if (parsed) return parsed;
  }
  return '';
}

function readCollapsedValue(rawValue) {
  const value = rawValue.trimStart();
  if (!value) return '';

  const quote = value[0];
  if (quote === '"' || quote === "'") {
    const end = value.indexOf(quote, 1);
    return end === -1 ? value.slice(1).trim() : value.slice(1, end).trim();
  }

  const tokenMatch = /^[^\s#;]+/.exec(value);
  return tokenMatch ? tokenMatch[0].trim() : '';
}

function parseDotenvValue(rawValue) {
  const value = String(rawValue || '').trim();
  if (value.startsWith('"') || value.startsWith("'")) {
    return readCollapsedValue(value);
  }
  return stripWrappingQuotes(stripInlineComment(value));
}

function stripInlineComment(value) {
  const trimmed = String(value || '').trim();
  if (trimmed.startsWith('"') || trimmed.startsWith("'")) return trimmed;
  return trimmed.replace(/\s+#.*$/, '').trim();
}

function stripWrappingQuotes(value) {
  const trimmed = String(value || '').trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}
