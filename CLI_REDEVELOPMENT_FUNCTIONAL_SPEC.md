# Claude Punk CLI Frontend Rewrite Spec

> 日期：2026-05-04  
> 用途：作為 Claude Punk 前端重寫規格。現有 backend 視為 source of truth，後續新專案應複製並保留後端能力，主要工作是將 browser/Phaser frontend 重寫為 fancy 的純 CLI/TUI 工具，並在後端補上身份驗證、權限控管、安全強化與驗收測試。

---

## 1. 產品目標

Claude Punk 將從瀏覽器像素酒吧遊戲，改成一個 local-first 的終端機管理工具，用來同時管理多個 AI coding agent session。

本規格不是「整個專案砍掉重寫」。現有 Node.js backend 已經包含核心價值，應先保留並搬移到新專案；frontend 才是主要重寫對象。後端只在必要處補上 auth、安全檢查、測試與小幅 protocol cleanup。

新版本必須保留目前專案後端已具備的能力：

- Claude/Codex PTY session 管理
- raw terminal input/output
- terminal replay / reconnect
- file watcher
- file tree / file browser
- file read/write/create/delete
- upload / download
- File Warp：從檔案樹快速插入路徑到 PTY
- Claude conversation resume
- Claude JSONL activity watcher
- `.claude/` config viewer
- REST API 與 WebSocket protocol

舊版 Phaser/browser UI 不再是主要前端。新的主要入口是全螢幕 CLI/TUI，不依賴瀏覽器、不使用 canvas、不需要 web frontend runtime。舊 frontend 可作為互動行為參考，但不應作為 runtime dependency。

---

## 2. 不可犧牲需求

1. 後端功能必須完整保留。
2. 前端必須改成純 CLI/TUI。
3. PTY 互動必須保留 raw input/output，可支援 Claude/Codex CLI 的 ANSI 與互動式輸出。
4. File Warp/File Wrap 必須保留：使用者可從檔案樹選取路徑，插入目前 PTY input。
5. File editor 必須保留：可開檔、編輯、儲存、顯示 dirty state。
6. File browser 必須保留：可瀏覽樹狀目錄、新增檔案/資料夾、刪除、刷新、看 metadata。
7. Download 必須保留：可把 session workDir 內的檔案下載到指定本機路徑。
8. Upload 必須保留：可把本機檔案上傳到 session workDir。
9. 多 session / 多視窗切換 hotkey 必須保留。
10. Token usage / cost / context 用量屬於 best effort。有可靠資料就顯示；沒有可靠資料就顯示 `unknown`，不要硬估到像真的。
11. REST 與 WebSocket 必須新增身份驗證與權限控管。
12. 必須有驗證機制：自動化測試加手動驗收清單，覆蓋所有保留功能。

---

## 3. 範圍

### 3.1 In Scope

- 複製並保留現有 Node.js backend 行為與 API 相容性。
- 重寫 frontend 為 CLI/TUI。
- 將現有 WebSocket/REST protocol 視為初始 backend contract。
- 在 backend 新增 token-based auth、login/logout、role checks、token revoke。
- 在 backend 強化 path validation、安全限制與測試。
- Session 建立、列表、切換、kill、resume。
- Terminal streaming、raw input、resize、replay、auto reconnect。
- File tree、File Warp、file browser、file editor、upload、download、create、delete。
- `.claude/` config viewer。
- Claude activity panel 的 CLI 等價功能。
- Token/context/cost usage 顯示，限可靠資料或明確標示 estimated/unknown。
- 功能測試、整合測試、CLI E2E smoke test。

### 3.2 Out of Scope

- Phaser 酒吧場景、角色、sprite、drink visual、jukebox、Retro TV、audio、browser theme settings、IndexedDB playlist。
- Browser Monaco editor 與 xterm.js。
- 完整重寫 backend runtime。
- 任意改名或破壞現有 backend protocol。
- 雲端 SaaS 多租戶產品。
- 取代 Claude CLI 或 Codex CLI 本身的登入；使用者仍需各自完成 Claude/Codex CLI 認證。

---

## 4. 目標使用者

- 同時開多個 Claude Code / Codex CLI session 的開發者。
- 偏好 keyboard-first terminal workflow 的使用者。
- 希望在同一個工具中完成 agent terminal、檔案瀏覽、檔案編輯與 session 管理的人。

---

## 5. 系統架構

```text
┌─────────────────────────────────────────────────────────────┐
│                       CLI/TUI Frontend                       │
│                                                             │
│  Full-screen terminal UI                                    │
│  - session list / hotkeys                                   │
│  - PTY terminal pane                                        │
│  - File Warp pane                                           │
│  - file browser                                             │
│  - file editor                                              │
│  - activity / usage panels                                  │
│                                                             │
│  Authenticated REST + WebSocket client                      │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP / WebSocket
                           │ Bearer token auth
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                         Node.js Backend                      │
│                                                             │
│  Express + ws + node-pty + chokidar                         │
│  - SessionManager                                           │
│  - FileWatcher                                              │
│  - ClaudeActivityWatcher                                    │
│  - REST API                                                 │
│  - WebSocket protocol                                       │
│  - auth middleware                                          │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                       Shell / Agent CLIs                     │
│                                                             │
│  login shell PTY                                            │
│  claude --dangerously-skip-permissions                      │
│  codex --full-auto                                          │
└─────────────────────────────────────────────────────────────┘
```

建議方向：

- 現有 backend 是新專案的起點與 source of truth。
- 第一版應直接複製 `backend/server.js` 與 backend package files，讓 server 先跑起來。
- 不應為了重寫 CLI 而先重寫 backend runtime。
- 後端可在後續從單檔 `backend/server.js` 拆模組，但這不是 frontend rewrite MVP 的必要條件。
- public protocol 必須維持相容。
- CLI 建議獨立成 `cli/` package，與 backend 共用 protocol type definitions。
- CLI/TUI library 必須支援 alternate screen、raw keyboard mode、mouse event、focus management、pane layout、ANSI passthrough。

---

## 6. Backend Contract

本章描述目前 `backend/server.js` 已存在且新版本必須保留的行為。重寫 frontend 時，CLI 必須以此 contract 對接 backend。除 auth/path safety/test 所需修改外，不應在第一階段改變這些訊息名稱、payload shape 或 session/file 行為。

### 6.1 Runtime Config

| Config | 目前預設 | 必須行為 |
|---|---:|---|
| `PORT` | `3000` | HTTP/WebSocket port |
| host | `127.0.0.1` | 預設只綁 local |
| `maxSessions` | `16` | 超過上限時拒絕建立 session |
| `fileCountRatio` | `20` | `drinkCount = floor(fileCount / 20)`，保留相容資料 |
| `AUTO_RUN_CLAUDE` | 非 `false` 即 true | session 建立後自動啟動選定 agent command |
| shell detection | platform-specific | Unix 使用 `$SHELL`，Windows 偵測 Git Bash / COMSPEC |
| agent commands | Claude/Codex | resolve command path 並補強 PTY PATH |
| PTY default size | `120x40` | 新 session 初始 cols/rows |
| raw replay buffer | 100KB | reconnect 時重播最近 terminal output |
| line ring buffer | 1000 lines | 保留清理過的 line history |
| file tree max depth | 10 | 避免無限制遞迴 |
| heartbeat | 30s | WebSocket ping/pong |
| shutdown timeout | 5s | graceful shutdown 後 force exit |

### 6.2 SessionManager

必須保留：

- 以 `{ workDir, label, agentType, resume }` 建立 session。
- 驗證 `workDir` 存在且為 directory。
- 驗證 `agentType` 支援。
- enforce max session 數量。
- 使用 `node-pty` spawn 真實 login shell。
- PTY cwd 必須是 `workDir`。
- PTY env 必須包含 `TERM=xterm-256color`。
- PTY PATH 必須包含 resolved Claude/Codex command 所在目錄。
- public session object 格式：

```json
{
  "id": "uuid",
  "state": "active",
  "workDir": "/absolute/path",
  "label": "project-name",
  "agentType": "claude",
  "createdAt": "ISO timestamp"
}
```

- Auto-run command：
  - Claude: `claude --dangerously-skip-permissions`
  - Codex: `codex --full-auto`
  - `resume === true` 時附加 `--resume`
  - `resume` 是 string 時附加 `--resume <conversationId>`
- raw PTY output emit 為 `terminal.output`。
- 清理過的 line output emit 為 `session.output`。
- 保存 raw replay buffer。
- 保存 clean line ring buffer。
- 接受 raw terminal input 並寫入 PTY。
- 接受 terminal resize 並更新 PTY cols/rows。
- kill session：
  - Unix: 先 `SIGTERM`，timeout 後 `SIGKILL`
  - Windows: 先 `taskkill /PID /T`，timeout 後 `/F /T`
- PTY exit 後 emit `session.terminated`。
- session terminated 後短暫保留再清除，讓事件能傳到 client。
- backend shutdown 時 kill all sessions、close watchers、close WebSocket/HTTP server。

### 6.3 WebSocket Protocol

Message envelope 必須維持：

```json
{
  "type": "event.name",
  "payload": {},
  "timestamp": "ISO timestamp"
}
```

Client to backend：

| Type | Payload | 行為 |
|---|---|---|
| `session.create` | `{ workDir, label, agentType, resume }` | 建立 PTY session，啟動 file/activity watcher |
| `session.prompt` | `{ sessionId, prompt }` | 寫入 prompt + newline |
| `terminal.input` | `{ sessionId, data }` | 寫入 raw data 到 PTY |
| `terminal.resize` | `{ sessionId, cols, rows }` | resize PTY |
| `session.kill` | `{ sessionId }` | terminate session 與 watchers |
| `fs.browse` | `{ path }` | 瀏覽 filesystem directory |
| `files.requestTree` | `{ sessionId }` | 回傳 project file tree |
| `file.read` | `{ sessionId, filePath }` | 讀 text/base64 image |
| `file.write` | `{ sessionId, filePath, content }` | 寫入 UTF-8 content |
| `file.create` | `{ sessionId, filePath, isDir }` | 建立 file/folder |
| `file.delete` | `{ sessionId, filePath }` | 刪除 file/folder，禁止刪 workDir root |
| `file.upload` | `{ sessionId, filePath, content, encoding }` | 上傳寫入檔案 |
| `file.download` | `{ sessionId, filePath }` | 回傳 base64 content |
| `claude.requestConfig` | `{ sessionId }` | 讀 `.claude/**/*.md` |
| `claude.listConversations` | `{ workDir }` | 列出 Claude JSONL conversations |
| `claude.watchActivity` | `{ sessionId }` | 訂閱並 backfill Claude activity |
| `claude.unwatchActivity` | `{ sessionId }` | 取消 activity watcher |

Backend to client：

| Type | Payload | 行為 |
|---|---|---|
| `session.update` | session | session 狀態 |
| `session.output` | `{ sessionId, stream, data, timestamp }` | clean line output |
| `terminal.output` | `{ sessionId, data }` | raw PTY output |
| `terminal.replay` | `{ sessionId, data, cols, rows }` | reconnect replay |
| `session.terminated` | `{ sessionId, exitCode }` | session ended |
| `files.update` | `{ sessionId, fileCount, drinkCount }` | file count 更新 |
| `files.tree` | `{ sessionId, tree }` | project tree |
| `fs.browse.result` | `{ path, parent, entries }` | directory browser result |
| `file.content` | `{ sessionId, filePath, content, encoding, fileType, size }` | file content |
| `file.saved` | `{ sessionId, filePath }` | save confirmation |
| `file.created` | `{ sessionId, filePath, isDir }` | create confirmation |
| `file.deleted` | `{ sessionId, filePath }` | delete confirmation |
| `file.uploaded` | `{ sessionId, filePath }` | upload confirmation |
| `file.downloadReady` | `{ sessionId, filePath, content, size }` | download payload |
| `claude.config` | `{ sessionId, files }` | `.claude` markdown files |
| `claude.conversations` | `{ workDir, conversations }` | resume picker data |
| `claude.activity` | `{ gameSessionId, events }` | parsed Claude activity |
| `error` | `{ message, code }` | protocol/runtime error |

Reconnect 時 backend 必須 replay：

- 所有 active sessions：`session.update`
- terminal raw buffer：`terminal.replay`
- 最新 file count：`files.update`

### 6.4 REST API

REST 必須保留且加上 auth：

| Method | Path | 行為 |
|---|---|---|
| `GET` | `/health` | unauthenticated health check，只回 `{ ok: true }` |
| `POST` | `/api/sessions` | create session |
| `GET` | `/api/sessions` | list active sessions |
| `GET` | `/api/sessions?all=true` | list all sessions |
| `GET` | `/api/sessions/:id` | get session |
| `DELETE` | `/api/sessions/:id` | kill session |

### 6.5 File System 行為

必須保留排除規則：

- `.git`
- `node_modules`
- `vendor`
- `__pycache__`
- `.venv`
- `venv`
- `.tox`
- `.mypy_cache`
- `.pytest_cache`
- `dist`
- `build`
- `.next`
- `.nuxt`
- `coverage`
- `.DS_Store`
- `Thumbs.db`
- hidden files/dirs 預設排除，但 `.claude` 例外保留

必須保留：

- recursive file count。
- `drinkCount = floor(fileCount / fileCountRatio)`，雖然新 CLI 不顯示酒杯，但 protocol 相容資料保留。
- recursive file tree：directories first、alphabetical、max depth。
- directory browser 排除 hidden/excluded items。
- `file.read` size limit 5MB。
- `file.upload` decoded size limit 5MB。
- `file.download` size limit 5MB。
- image/binary read as base64。
- text read as UTF-8。
- upload/create file 時自動建立 parent directory。
- delete directory 使用 recursive remove。
- 所有 file operation 必須擋 path traversal。

Path validation 必須強化：

- `workDir` 啟動時 resolve 成 canonical absolute path。
- target path resolve 後用 `path.relative(workDir, target)` 檢查。
- 若 relative path 以 `..` 開頭或是 absolute path，拒絕。
- 不可只用 `target.startsWith(workDir)`，避免 `/repo` 與 `/repo-other` 類似 prefix 出錯。

### 6.6 ClaudeActivityWatcher

必須保留：

- 將 `workDir` 對應到 `~/.claude/projects/<encoded-workdir>`。
- `claude.listConversations` 回傳最近 30 筆 JSONL conversations。
- conversation metadata：
  - `sessionId`
  - `firstUserText`
  - `createdAt`
  - `lastActiveAt`
  - `sizeBytes`
- chokidar 監看 JSONL。
- 若 project dir 尚未存在，defer watch 並 retry。
- JSONL file owner mapping，避免不同 game/backend sessions 的 activity 混線。
- parse events：
  - assistant text
  - usage
  - tool_use
  - thinking
  - subagent progress
  - user message
  - API error
- 支援依 session createdAt 做 recent event backfill。
- emit `claude.activity`。

### 6.7 Claude Config

必須保留：

- 讀取 session workDir 下 `.claude/`。
- recursive 收集 Markdown files。
- 回傳 `{ name, content }`。
- 單一檔案讀取失敗不得讓整個 request failed。

---

## 7. 身份驗證與權限控管

### 7.1 目標

後端可操作 shell、PTY、檔案讀寫與刪除，必須保護所有敏感入口。

需要 auth 的範圍：

- WebSocket `/ws`
- 所有 `/api/*`
- session create/kill/list/detail
- terminal input/resize
- file read/write/create/delete/upload/download
- activity/config/conversation reads

允許 unauthenticated：

- `GET /health`，且不可回傳敏感資訊
- 初始 local pairing endpoint，如果實作

### 7.2 Auth Model

採 Bearer token。

Token 來源：

1. HTTP header：`Authorization: Bearer <token>`
2. CLI config：`~/.claude-punk/client.json`
3. Env：`CLAUDE_PUNK_TOKEN`

WebSocket upgrade 必須帶 token。CLI 優先使用 header。query-string token fallback 只允許 localhost development，且 server bind 到 non-local host 時必須停用。

### 7.3 Server Token Store

預設 server-side token store：

```text
~/.claude-punk/auth.json
```

只存 hash，不存 plaintext：

```json
{
  "version": 1,
  "tokens": [
    {
      "id": "tok_xxx",
      "name": "main-cli",
      "hash": "scrypt-or-argon2-hash",
      "role": "admin",
      "createdAt": "ISO timestamp",
      "lastUsedAt": "ISO timestamp or null",
      "revokedAt": null
    }
  ]
}
```

Plain token 只在 create 時顯示一次。

### 7.4 Roles

| Role | 權限 |
|---|---|
| `admin` | 全部操作；可建立/revoke token；可改 server config |
| `operator` | session create/list/kill、terminal input、file read/write/upload/download/delete |
| `viewer` | 只能觀看 session、terminal、activity、files；不可寫入、不可 kill、不可送 PTY input |

MVP 可以先只實作 `admin` 與 `operator`，但 middleware 架構必須 role-aware。

### 7.5 CLI Auth Commands

必須提供：

```bash
claude-punk login --server http://127.0.0.1:3000
claude-punk logout
claude-punk whoami
claude-punk token create --name laptop --role operator
claude-punk token list
claude-punk token revoke <token-id>
```

Local pairing flow：

1. 啟動 backend。
2. 若沒有任何 token，backend 建立 initial admin token 並只印出一次。
3. 使用者執行 `claude-punk login`，貼上 token。
4. CLI 將 token 存在 `~/.claude-punk/client.json`，檔案權限必須是 `0600` 或 OS 等價保護。

### 7.6 Auth Errors

REST：

- missing token：`401 { "error": "AUTH_REQUIRED" }`
- invalid token：`401 { "error": "AUTH_INVALID" }`
- role insufficient：`403 { "error": "AUTH_FORBIDDEN" }`

WebSocket：

- missing/invalid token：upgrade 時以 HTTP 401 reject。
- 若 library 限制導致連上後才能拒絕，必須立即 send `error` 並 close。

### 7.7 Security Requirements

- 預設 bind `127.0.0.1`。
- bind `0.0.0.0` 必須明確設定並印 warning。
- CORS 預設 disabled 或 strict localhost。
- 不可 log bearer token plaintext。
- token 不可進入 terminal replay buffer、error payload、audit detail。
- enforce max WebSocket payload。
- failed auth 做基本 rate limit。
- audit log 下列敏感操作：
  - token create/revoke
  - session create/kill
  - file write/upload/delete/download

---

## 8. CLI/TUI 功能規格

### 8.1 CLI Package

主要命令：

```bash
claude-punk                 # 開啟 full-screen TUI
claude-punk tui             # 同上
claude-punk server start    # 啟動 backend
claude-punk server stop     # 若由 CLI 管理，停止 backend
claude-punk login
claude-punk logout
claude-punk session list
claude-punk session create <workDir> --agent claude --label name
claude-punk session kill <sessionId>
claude-punk upload <sessionId> <localPath> [remotePath]
claude-punk download <sessionId> <remotePath> [localPath]
```

Full-screen TUI 是主體驗；非互動命令用於 scripting 與驗證。

### 8.2 預設 TUI Layout

```text
┌ Claude Punk CLI ─────────────────────────────────────────────── ONLINE 3/16 ┐
│ [a] claude project-api active ctx 42% cost $0.12  [b] codex ui active       │
├ Sessions ───────┬ Terminal ───────────────────────────────┬ File Warp ─────┤
│ a project-api   │ raw PTY output                           │ src/           │
│ b ui-refactor   │ cursor + ANSI/TUI rendering              │   main.js      │
│                 │                                          │   server.js    │
│                 │                                          │ Quick Cmds     │
├ Browser/Editor ─┴──────────────────────────────────────────┴───────────────┤
│ file tree / editor / activity / config / usage depending on active window   │
├─────────────────────────────────────────────────────────────────────────────┤
│ Ctrl+` cmd  Alt+a..z switch  Ctrl+N new  Ctrl+P palette  F2 files  F3 edit  │
└─────────────────────────────────────────────────────────────────────────────┘
```

必備 pane/window：

- Sessions
- Terminal
- File Warp
- File Browser
- File Editor
- Activity
- Config
- Usage
- Command Palette
- Notifications / errors

Layout 必須支援：

- terminal resize
- keyboard-only navigation
- mouse click selection，若 terminal 支援
- split resize 或 preset layout
- small terminal compact mode
- alternate screen，退出時恢復 terminal 狀態

### 8.3 UI Modes

TUI 分兩種模式：

| Mode | 行為 |
|---|---|
| Terminal focus mode | 大多數 key 直接送到 active PTY |
| Command mode | global hotkeys、pane navigation、palette、file browser/editor 操作 |

Reserved global hotkeys 必須先攔截，不可送到 PTY：

| Hotkey | Action |
|---|---|
| `Ctrl+\`` | toggle command mode / close modal |
| `Alt+a` - `Alt+z` | 切換到指定 hotkey session |
| `Alt+Left` / `Alt+Right` | previous/next session |
| `Ctrl+N` | new session flow |
| `Ctrl+P` | command palette |
| `Ctrl+W` | pane/window switcher |
| `F1` | help |
| `F2` | file browser |
| `F3` | file editor |
| `F4` | activity |
| `F5` | refresh active panel/tree |
| `F9` | kill active session，需 confirmation |
| `Esc` | close modal 或回 terminal focus |

當 modal/editor focus 時，快捷鍵必須 context-aware，不得意外送 destructive input 到 PTY。

### 8.4 Session List 與多視窗切換

必須：

- 顯示所有 active backend sessions。
- session 依序分配 `a-z` hotkey，terminated 後回收。
- 顯示 label、agent type、state、workDir basename、created time、hotkey。
- `Alt+letter` 切 session。
- 支援 backend `maxSessions`。
- session terminated 時：
  - 釋放 hotkey；
  - 標記 terminated；
  - 保留最後 terminal output，直到 user 關閉；
  - backend 不再回報後從 active list 移除。
- reconnect 時：
  - 從 `session.update` 重建 list；
  - 能恢復原 active session 就恢復；
  - 套用 `terminal.replay`。

### 8.5 New Session Flow

流程：

1. `Ctrl+N` 或 command palette 開啟。
2. 從 home 或 recent folder parent 開始 browse filesystem。
3. 可手動輸入 path。
4. 選 agent type：
   - Claude Code
   - Codex
5. 輸入 optional label。
6. 呼叫 `session.create`。
7. 建立成功後 focus 新 terminal。

Recent folders 保存於：

```text
~/.claude-punk/recent-folders.json
```

最多 10 筆。

### 8.6 Resume Conversation Flow

Claude 必須支援：

1. 從 command palette 開啟 Resume。
2. 顯示 recent folders。
3. user 選 folder。
4. CLI 呼叫 `claude.listConversations`。
5. 顯示最多 30 筆 conversations：
   - relative last active time
   - first user text
   - size
   - session ID 放 secondary/hidden detail
6. 選 conversation 後以 `resume=<conversationId>` 建立 Claude session。

Codex resume 不列為 MVP，除非有可靠 Codex conversation source。

### 8.7 PTY Terminal Pane

必須：

- render `terminal.output` raw data。
- raw keystrokes 送 `terminal.input`。
- terminal resize 送 `terminal.resize`。
- reconnect 後套用 `terminal.replay`。
- connected 時本地保留 scrollback。
- 支援 ANSI colors 與常見 cursor movement。
- 支援 Claude/Codex CLI 互動式狀態。
- render path 不可使用 clean line output；clean line 只給 activity/speech-like summaries。

連線狀態必須清楚顯示：

- online
- reconnecting
- offline
- authenticated but forbidden
- auth expired/invalid

### 8.8 File Warp / File Wrap Pane

File Warp 是 terminal 旁的快速路徑面板。

必須：

- 透過 `files.requestTree` 取得 tree。
- render collapsible tree。
- 支援 filename filter/search。
- 選 file/folder。
- 將路徑插入 active PTY input，不自動按 Enter。
- 支援 path mode：
  - raw relative path
  - shell-quoted path
  - `@path` style，若 user config 開啟
- 手動 refresh 與 `files.update` 後 auto refresh。
- 支援 per-agent quick commands。

Quick command defaults：

| Agent | Defaults |
|---|---|
| Claude | `/cost`, `/compact` |
| Codex | `/help` |

Quick commands 保存於：

```text
~/.claude-punk/quick-commands.json
```

### 8.9 File Browser

必須：

- 顯示 `files.tree`。
- 顯示 file count 與相容用 `drinkCount`。
- expand/collapse directories。
- open selected file in editor。
- create file。
- create folder。
- delete file/folder，必須 confirmation。
- refresh tree。
- download selected file。
- upload local file(s) 到 current directory 或 project root。
- 顯示 file size。
- 顯示 backend errors。

Nice-to-have：

- fuzzy finder
- rename/move，需 backend 新增 `file.rename`
- git status badges

### 8.10 File Editor

必須：

- 透過 `file.read` 開 text files。
- 顯示 path、size、encoding、dirty state。
- 預設 read-only。
- 可 toggle edit mode。
- 透過 `file.write` save。
- 顯示 save success/failure。
- dirty buffer close 前 warning。
- 支援 line numbers 與 search。
- 支援 terminal copy/paste 能力。
- 遵守 backend 5MB 限制。

Text editing MVP：

- 必須有內建 TUI editor，支援基本多行編輯、cursor move、insert/delete、save、cancel。
- Syntax highlighting optional。

External editor fallback：

- 提供 `Open in $EDITOR`。
- 外部 editor 結束後，仍必須走 backend `file.write`/upload protocol，不可繞過 auth/audit 直接寫檔。

Preview：

- Markdown/HTML/SVG browser-like preview 不要求。
- Markdown 可做 terminal formatted render，但非必須。
- image/binary 顯示 metadata，提供 download/open-with-system-viewer。

### 8.11 Upload

TUI 必須：

- 選 local path(s)。
- 選 remote target directory/filename。
- text 以 UTF-8 傳。
- binary 以 base64 傳。
- 呼叫 `file.upload`。
- 顯示 progress/status。
- 成功後 refresh tree。

Non-interactive command：

```bash
claude-punk upload <sessionId> ./local.png assets/local.png
```

MVP 可拒絕 directory upload；若要 recursive upload 必須另寫規格。

### 8.12 Download

TUI 必須：

- 選 remote file。
- 選 local destination。
- 呼叫 `file.download`。
- decode base64。
- 寫入 local file。
- overwrite 前詢問。

Non-interactive command：

```bash
claude-punk download <sessionId> src/main.js ./main.js
```

MVP 不支援 directory download。

### 8.13 Activity Panel

必須：

- 透過 `claude.watchActivity` subscribe。
- render recent + live `claude.activity` events。
- 顯示：
  - workflow/tool timeline
  - latest thinking
  - latest plan
  - written/edited files
  - subagent/task/team/skill events
  - text/bash/error feed
- teardown 時呼叫 `claude.unwatchActivity`。
- Activity 是 Claude-first。Codex 沒有可靠 source 時顯示 `activity unavailable`。

### 8.14 Config Panel

必須：

- 呼叫 `claude.requestConfig`。
- 顯示 `.claude` Markdown files。
- expand/collapse content。
- refresh。
- 若檔案在 tree 中存在，可用 file editor 開啟。

### 8.15 Usage / Token / Cost / Context

這項不阻塞 MVP。

必須遵守：

- Claude JSONL activity 有 usage 時：
  - context tokens = `inputTokens + cacheRead + cacheCreation`
  - 顯示 context percentage
- CLI output 有 parseable cost 時：
  - 顯示 parsed cost
- 沒有可靠資料時：
  - 顯示 `unknown`
  - 不顯示假精準數字

建議重構：

- 把 token/cost/context aggregation 移到 backend。
- CLI 只負責顯示。
- 新增 optional event：

```json
{
  "type": "usage.update",
  "payload": {
    "sessionId": "uuid",
    "agentType": "claude",
    "source": "claude-jsonl|cli-cost|heuristic|unknown",
    "inputTokens": 123,
    "outputTokens": 456,
    "cacheRead": 1000,
    "cacheCreation": 200,
    "contextTokens": 1200,
    "contextPercent": 0.6,
    "estimatedCostUsd": 0.12
  }
}
```

若此 event 不實作，CLI 可從 `claude.activity` derive，但 heuristic 必須標示 estimated。

### 8.16 Notifications / Errors

CLI 必須有非阻塞通知：

- WebSocket reconnecting/reconnected/offline
- auth failures
- session created/terminated
- file saved/uploaded/downloaded/deleted
- backend errors

下列操作必須 confirmation：

- kill session
- delete file/folder
- overwrite local download target
- overwrite remote upload target，若有 overwrite detection

---

## 9. Persistence

CLI persistence 目錄：

```text
~/.claude-punk/
```

必備檔案：

| File | 用途 |
|---|---|
| `client.json` | server URL、selected profile、token，需 OS file permission 保護 |
| `recent-folders.json` | 最近 10 個 project directories |
| `quick-commands.json` | per-agent File Warp quick commands |
| `layout.json` | pane size、active layout preset |
| `auth.json` | backend token hashes，server-side only |

不可保存：

- terminal replay content
- agent secrets
- upload/download file content

---

## 10. 可選後端整理

本章不是 frontend rewrite MVP 的必要工作。第一版應先複製現有 backend，補 auth、path safety 與測試，讓 CLI 可以直接對接現有 protocol。

等 CLI 功能穩定後，才考慮把 `backend/server.js` 拆成模組。拆分時 protocol 必須相容。

建議結構：

```text
backend/src/config.js
backend/src/auth/tokenStore.js
backend/src/auth/middleware.js
backend/src/session/SessionManager.js
backend/src/session/RingBuffer.js
backend/src/session/LineBuffer.js
backend/src/files/FileWatcher.js
backend/src/files/fileTree.js
backend/src/claude/activityWatcher.js
backend/src/claude/conversations.js
backend/src/ws/server.js
backend/src/rest/router.js
backend/src/server.js
```

規則：

- protocol message names 穩定。
- 新增 message 時加 protocol version metadata。
- CLI migration 完成前，舊 message 不可破壞。
- auth checks 放在 REST/WS ingress。
- path validation 抽成 shared helper。
- 改動 file/session semantics 前先補測試。

---

## 11. Copy 清單

後續用 copy 走的檔案加上本 spec 重新開發時，建議分成「必帶」與「參考」兩組。

### 11.1 必帶檔案

這些是讓新專案保留現有後端能力的最小集合：

| 檔案 | 用途 |
|---|---|
| `CLI_REDEVELOPMENT_FUNCTIONAL_SPEC.md` | 本規格 |
| `backend/server.js` | 現有 backend source of truth：PTY、WS、REST、file APIs、activity watcher |
| `backend/package.json` | backend dependency/script 定義 |
| `backend/package-lock.json` | backend dependency lock |

如果新專案仍用 npm workspace 啟動，也一起 copy：

| 檔案 | 用途 |
|---|---|
| `package.json` | root workspace scripts |
| `package-lock.json` | root dependency lock |
| `pnpm-workspace.yaml` | workspace layout 參考 |
| `start.sh` | 現有啟動腳本參考 |
| `stop.sh` | 現有停止腳本參考 |

### 11.2 建議參考檔案

這些檔案不應成為新 CLI runtime dependency，但可用來還原前端行為與 protocol usage：

| 檔案 | 參考內容 |
|---|---|
| `frontend/src/services/websocket.js` | 現有 WebSocket client methods 與 message names |
| `frontend/src/ui/TerminalTab.js` | terminal replay、resize、raw input/output 行為 |
| `frontend/src/ui/FileWarpPanel.js` | File Warp tree、path insert、quick commands |
| `frontend/src/ui/FilesTab.js` | file browser、create/delete/upload/download flow |
| `frontend/src/ui/FileEditor.js` | editor read/write、previewable file 判斷、download flow |
| `frontend/src/ui/FolderPicker.js` | project picker、recent folders、agent type selection |
| `frontend/src/ui/ResumePicker.js` | Claude conversation resume flow |
| `frontend/src/ui/ClaudeConfigTab.js` | `.claude` config request/render flow |
| `frontend/src/ui/ActivityPanel.js` | Claude activity event routing 與 panel model |
| `frontend/src/services/costTracker.js` | 舊 cost heuristic，僅供判斷哪些資料不可靠 |
| `frontend/src/services/contextTracker.js` | Claude usage/context 計算方式 |
| `frontend/src/managers/HotkeyManager.js` | hotkey assignment/recycling 規則 |
| `readme.md` | 使用流程、功能描述、疑難排解 |

### 11.3 不需要 copy 的檔案

除非要保留舊 browser/game frontend，否則不需要 copy：

- `frontend/public/assets/**`
- Phaser scene/entities
- CSS themes
- jukebox / Retro TV / audio 相關檔案
- browser-only `frontend/package.json` 與 `frontend/package-lock.json`

---

## 12. 驗證機制

### 12.1 自動化測試層級

| Layer | Coverage |
|---|---|
| Unit | config、path validation、auth token hashing、role checks、file tree filtering、Claude JSONL parsing |
| Backend integration | fake agent session create/kill、PTY input/output、resize、terminal replay、file APIs、activity backfill |
| WebSocket protocol | auth required、reconnect replay、error codes、max payload |
| REST API | auth、session CRUD、status codes |
| CLI command tests | login/logout、upload/download、session list/create/kill |
| CLI TUI smoke tests | pseudo-terminal 中開 TUI、切 panes、接收 fake terminal output |
| Security regression | path traversal、revoked token、viewer role write denial |

建議 fake agent：

```bash
node test/fixtures/fake-agent.js
```

fake agent 需支援：

- 印 ANSI output
- echo stdin
- 可觀測 resize，若可行
- 可寫 Claude-like JSONL activity fixtures
- 收到指定 command 後 exit

### 12.2 手動驗收清單

Release 前必須檢查：

- `claude-punk login` 可存 token，`whoami` 成功。
- 沒 token 無法連 WebSocket。
- TUI 開啟後能列出 backend active sessions。
- 可在指定 project directory 建立 Claude session。
- 安裝 Codex CLI 時可建立 Codex session。
- Terminal pane 可 raw typing 並與 Claude/Codex 互動。
- `Ctrl+\`` 可離開 terminal focus，不污染 PTY input。
- `Alt+a` 到 `Alt+z` 可切換 sessions。
- CLI 關掉重開後，backend active session 可 replay terminal output。
- terminal resize 會同步 PTY dimensions。
- File Warp 選 path 後可插入 PTY input。
- Quick command 可插入/送出 configured command。
- File browser 在 filesystem changes 後能 refresh。
- create file、create folder、delete file、delete folder 都成功。
- File editor 可 open text、edit、save，disk content 正確。
- dirty editor close 前有提示。
- Upload 可把本機檔案寫入 session workDir。
- Download 可把 remote file 寫到指定 local path。
- Config panel 可顯示 `.claude` Markdown。
- Resume picker 可列 recent Claude conversations 並 resume。
- Activity panel 在 JSONL 存在時可顯示 Claude tool/thinking/text events。
- Usage panel 有可靠資料就顯示，沒有就 `unknown`。
- viewer token 不可 write files、send PTY input、upload、delete、kill。
- operator token 不可 create/revoke tokens。
- admin token 可 revoke token，revoked token 立即失效。

### 12.3 Performance Acceptance

最低標準：

- 16 active sessions 可列出與切換。
- 10,000 個非 excluded files 的 project 不會凍結 CLI。
- file tree refresh 有 debounce，不 flood backend。
- 100KB terminal output replay 不 crash TUI。
- WebSocket reconnect backoff 約 1s 起跳，最高約 30s。
- `120x40` terminal 完整可用。
- `80x24` terminal 進入 compact layout。

### 12.4 Release Gates

Release candidate 必須滿足：

- 自動化測試全部通過。
- 手動驗收必備項全部通過。
- REST/WebSocket auth 無法 bypass。
- file read/write/upload/download/create/delete 無 path traversal。
- backend shutdown 會 kill PTY sessions。
- CLI exit 後 terminal state 正常恢復。

---

## 13. Migration Plan

### Phase 1：複製後端並凍結契約

- copy `backend/server.js`、backend package files 與本 spec 到新專案。
- 先讓 backend 在新專案可啟動。
- 補 protocol type definitions。
- 對現有行為補測試。
- 加 auth middleware/token store。
- 強化 path validation。
- 此階段不重寫 backend runtime。

### Phase 2：建立 CLI Core

- 實作 login/config。
- 實作 WebSocket client、reconnect、replay handling。
- 實作 session list、new session、kill session。
- 實作 terminal pane raw input/output/resize。

### Phase 3：補齊 File Workflows

- File Warp。
- File browser。
- File editor。
- Upload/download。
- Config viewer。

### Phase 4：Activity 與 Usage

- Activity panel。
- 若可行，把 usage aggregation 移到 backend。
- Token/context/cost 顯示 reliable/estimated/unknown。

### Phase 5：驗證與切換

- 完成測試。
- 跑手動驗收。
- 不再導入 browser frontend；必要時只保留參考檔案或 archived copy。
- 更新 README、install/start scripts。

---

## 14. 完成定義

CLI frontend rewrite 完成時，使用者可以執行：

```bash
claude-punk server start
claude-punk login
claude-punk
```

並且完全在 terminal UI 裡完成：

- create/resume Claude/Codex sessions
- 透過真實 PTY 與 agent 互動
- 用 hotkey 切換 sessions
- browse project files
- 透過 File Warp 插入路徑到 terminal input
- edit/save files
- upload/download files
- inspect `.claude` config
- kill sessions
- reconnect 後不丟 active session state
- 所有敏感操作皆需 authenticated access

Token usage/cost 的完成標準：

- reliable data 顯示且標出 source；
- heuristic data 清楚標示 estimated；
- unavailable data 顯示 unknown，不阻塞 workflow。
