/**
 * CostTracker — estimates API token usage and cost per session
 * from terminal output. Uses a hybrid approach:
 *   1. Parse Claude CLI cost output when available (accurate)
 *   2. Fall back to character-count heuristic (approximate)
 *
 * Session cost data is persisted to localStorage so values survive
 * page refreshes. Entries are cleaned up on session removal and
 * auto-expire after 24 hours as a safety net.
 */

// ANSI escape sequence stripper
const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?(?:\x07|\x1b\\)/g;
function stripAnsi(text) {
  return text.replace(ANSI_RE, '');
}

// Patterns to detect cost/token info from Claude CLI output
const COST_PATTERNS = {
  totalCost: /total\s+cost:\s*\$?([\d.]+)/i,
  inputTokens: /input\s+tokens?:\s*([\d,]+)/i,
  outputTokens: /output\s+tokens?:\s*([\d,]+)/i,
  tokensUsed: /tokens?\s+used:\s*([\d,]+)/i,
};

// Default pricing per 1K tokens (USD)
const DEFAULT_PRICING = {
  claude: { input: 0.003, output: 0.015 },
  codex: { input: 0.003, output: 0.012 },
};

// Average ~4 characters per token for English code-heavy text
const CHARS_PER_TOKEN = 4;

const STORAGE_KEY = 'costTracker.sessions';
const SAVE_DEBOUNCE_MS = 2000;
const EXPIRY_MS = 24 * 60 * 60 * 1000; // 24h

class CostTracker {
  constructor() {
    /** @type {Map<string, SessionCost>} */
    this.sessions = new Map();
    this.listeners = new Set();
    this._saveTimer = null;
    this.loadBudget();
    this._pruneExpired();
  }

  // ─── localStorage persistence ─────────────────────────────────────────

  /** Load a single session's persisted cost data (if any). */
  _loadSession(sessionId) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const store = JSON.parse(raw);
      const entry = store[sessionId];
      if (!entry) return null;
      // Check 24h expiry
      if (Date.now() - entry.savedAt > EXPIRY_MS) {
        delete store[sessionId];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
        return null;
      }
      return entry;
    } catch {
      return null;
    }
  }

  /** Debounced save of all active sessions to localStorage. */
  _scheduleSave() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._saveNow();
    }, SAVE_DEBOUNCE_MS);
  }

  _saveNow() {
    try {
      // Read existing store so we don't clobber entries from other tabs
      let store = {};
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) store = JSON.parse(raw);
      } catch { /* start fresh */ }

      const now = Date.now();
      for (const [id, s] of this.sessions) {
        store[id] = {
          sessionId: s.sessionId,
          agentType: s.agentType,
          inputTokens: s.inputTokens,
          outputTokens: s.outputTokens,
          estimatedCost: s.estimatedCost,
          totalChars: s.totalChars,
          parsedCost: s.parsedCost,
          method: s.method,
          createdAt: s.createdAt,
          savedAt: now,
        };
      }

      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch { /* localStorage full or unavailable — ignore */ }
  }

  /** Remove a single session from localStorage. */
  _deleteFromStorage(sessionId) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const store = JSON.parse(raw);
      delete store[sessionId];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch { /* ignore */ }
  }

  /** Remove entries older than 24h on startup. */
  _pruneExpired() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const store = JSON.parse(raw);
      const now = Date.now();
      let changed = false;
      for (const id of Object.keys(store)) {
        if (now - store[id].savedAt > EXPIRY_MS) {
          delete store[id];
          changed = true;
        }
      }
      if (changed) localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch { /* ignore */ }
  }

  // ─── Core API ─────────────────────────────────────────────────────────

  /**
   * Initialize tracking for a session.
   * Restores persisted cost data if available.
   * @param {string} sessionId
   * @param {string} agentType - 'claude' or 'codex'
   */
  initSession(sessionId, agentType = 'claude') {
    if (this.sessions.has(sessionId)) return;

    const saved = this._loadSession(sessionId);
    if (saved) {
      this.sessions.set(sessionId, {
        sessionId,
        agentType: saved.agentType || agentType,
        inputTokens: saved.inputTokens || 0,
        outputTokens: saved.outputTokens || 0,
        estimatedCost: saved.estimatedCost || 0,
        totalChars: saved.totalChars || 0,
        parsedCost: saved.parsedCost ?? null,
        method: saved.method || 'heuristic',
        createdAt: saved.createdAt || new Date().toISOString(),
      });
    } else {
      this.sessions.set(sessionId, {
        sessionId,
        agentType,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCost: 0,
        totalChars: 0,
        parsedCost: null,
        method: 'heuristic',
        createdAt: new Date().toISOString(),
      });
    }
    this.notify(sessionId);
  }

  /**
   * Process raw terminal output for cost estimation.
   * @param {string} sessionId
   * @param {string} data - Raw PTY output chunk
   */
  onTerminalOutput(sessionId, data) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const text = stripAnsi(data);
    session.totalChars += text.length;

    // Try to parse CLI cost output
    this.parseCostOutput(session, text);

    // Update heuristic estimate
    this.updateHeuristic(session);

    this._scheduleSave();
    this.notify(sessionId);
  }

  /** Parse CLI-reported cost/token data from output text. */
  parseCostOutput(session, text) {
    const costMatch = text.match(COST_PATTERNS.totalCost);
    if (costMatch) {
      session.parsedCost = parseFloat(costMatch[1]);
      session.estimatedCost = session.parsedCost;
      session.method = 'parsed';
    }

    const inputMatch = text.match(COST_PATTERNS.inputTokens);
    if (inputMatch) {
      session.inputTokens = parseInt(inputMatch[1].replace(/,/g, ''), 10);
      session.method = 'parsed';
    }

    const outputMatch = text.match(COST_PATTERNS.outputTokens);
    if (outputMatch) {
      session.outputTokens = parseInt(outputMatch[1].replace(/,/g, ''), 10);
      session.method = 'parsed';
    }

    const totalMatch = text.match(COST_PATTERNS.tokensUsed);
    if (totalMatch && session.method !== 'parsed') {
      const total = parseInt(totalMatch[1].replace(/,/g, ''), 10);
      // Split roughly 60/40 input/output when we only have total
      session.inputTokens = Math.round(total * 0.6);
      session.outputTokens = total - session.inputTokens;
    }
  }

  /** Update cost estimate from character count heuristic. */
  updateHeuristic(session) {
    if (session.method === 'parsed') return;

    const estimatedTokens = Math.ceil(session.totalChars / CHARS_PER_TOKEN);
    // Output-only estimate (we see output, input is hidden)
    // Assume input is roughly 1.5x output for conversational code agents
    session.outputTokens = estimatedTokens;
    session.inputTokens = Math.round(estimatedTokens * 1.5);

    const pricing = DEFAULT_PRICING[session.agentType] || DEFAULT_PRICING.claude;
    session.estimatedCost =
      (session.inputTokens / 1000) * pricing.input +
      (session.outputTokens / 1000) * pricing.output;
  }

  /**
   * Get cost data for a session.
   * @param {string} sessionId
   * @returns {{ cost: number, inputTokens: number, outputTokens: number, method: string } | null}
   */
  getSessionCost(sessionId) {
    const s = this.sessions.get(sessionId);
    if (!s) return null;
    return {
      cost: s.estimatedCost,
      inputTokens: s.inputTokens,
      outputTokens: s.outputTokens,
      method: s.method,
    };
  }

  /** Get total cost across all active sessions. */
  getTotalCost() {
    let total = 0;
    for (const s of this.sessions.values()) {
      total += s.estimatedCost;
    }
    return total;
  }

  /** Get cost summary for all sessions. */
  getAllSessions() {
    return Array.from(this.sessions.values()).map((s) => ({
      sessionId: s.sessionId,
      agentType: s.agentType,
      cost: s.estimatedCost,
      inputTokens: s.inputTokens,
      outputTokens: s.outputTokens,
      method: s.method,
    }));
  }

  /** Format cost as display string. */
  formatCost(cost) {
    if (cost < 0.01) return '$0.00';
    return `$${cost.toFixed(2)}`;
  }

  /** Format token count for display. */
  formatTokens(count) {
    if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
    return `${count}`;
  }

  /** Budget helpers */
  loadBudget() {
    try {
      const raw = localStorage.getItem('costTracker');
      this.budget = raw ? JSON.parse(raw) : { monthlyBudget: 0, alertThreshold: 80 };
    } catch {
      this.budget = { monthlyBudget: 0, alertThreshold: 80 };
    }
  }

  getBudgetStatus() {
    const total = this.getTotalCost();
    const budget = this.budget.monthlyBudget;
    return {
      used: total,
      budget,
      percentage: budget > 0 ? Math.min((total / budget) * 100, 100) : 0,
    };
  }

  /** Subscribe to cost updates. */
  onChange(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /** Notify listeners of a change. */
  notify(sessionId) {
    for (const cb of this.listeners) {
      try { cb(sessionId); } catch { /* ignore */ }
    }
  }

  /** Remove session tracking and its persisted data. */
  removeSession(sessionId) {
    this.sessions.delete(sessionId);
    this._deleteFromStorage(sessionId);
    this.notify(sessionId);
  }
}

// Singleton
const costTracker = new CostTracker();
export default costTracker;
