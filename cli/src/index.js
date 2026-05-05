#!/usr/bin/env node
import { Command } from 'commander';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { createApi, readLocalUpload } from './api.js';
import {
  CLIENT_CONFIG_PATH,
  readClientConfig,
  resolveServerUrl,
  writeClientConfig,
  rememberFolder,
} from './config.js';
import { ProtocolClient } from './wsClient.js';
import { runTui } from './tui/app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const backendDir = path.join(repoRoot, 'backend');

const program = new Command();

program
  .name('claude-punk')
  .description('Terminal-first Claude Punk CLI/TUI')
  .option('--server <url>', 'backend server URL')
  .option('--token <token>', 'bearer token for auth-enabled backends');

program
  .command('tui')
  .description('open the full-screen TUI')
  .action(async () => {
    await runTui(program.opts());
  });

program
  .command('login')
  .description('store backend URL and bearer token in ~/.claude-punk/client.json')
  .option('--server <url>', 'backend server URL')
  .option('--token <token>', 'token supplied non-interactively')
  .action(async (options) => {
    const serverUrl = resolveServerUrl({ ...program.opts(), ...options });
    const token = options.token || await promptToken();
    const existing = readClientConfig();
    writeClientConfig({ ...existing, serverUrl, token });
    console.log(`Logged in to ${serverUrl}`);
    console.log(`Config: ${CLIENT_CONFIG_PATH}`);
  });

program
  .command('logout')
  .description('remove the stored bearer token')
  .action(() => {
    const existing = readClientConfig();
    delete existing.token;
    writeClientConfig(existing);
    console.log('Logged out');
  });

program
  .command('whoami')
  .description('show current auth identity when backend auth is enabled')
  .action(async () => {
    const api = createApi(program.opts());
    try {
      const identity = await api.whoami();
      console.log(JSON.stringify(identity, null, 2));
    } catch (error) {
      if (error.status === 404) {
        await api.health();
        console.log('Backend is reachable, but auth identity endpoints are not implemented yet.');
        return;
      }
      throw error;
    }
  });

const server = program.command('server').description('manage the local backend');

server
  .command('start')
  .description('start backend/server.js in the foreground')
  .action(() => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: backendDir,
      stdio: 'inherit',
      env: process.env,
    });
    child.on('exit', (code, signal) => {
      if (signal) process.kill(process.pid, signal);
      process.exit(code ?? 0);
    });
  });

server
  .command('stop')
  .description('print stop guidance for a foreground backend')
  .action(() => {
    console.log('Stop the foreground backend with Ctrl+C in the terminal where it is running.');
  });

const session = program.command('session').description('session commands');

session
  .command('list')
  .description('list backend sessions')
  .option('--all', 'include terminated sessions')
  .action(async (options) => {
    const api = createApi(program.opts());
    const sessions = await api.listSessions(!!options.all);
    printSessions(sessions);
  });

session
  .command('create')
  .description('create a backend PTY session')
  .argument('<workDir>', 'project directory')
  .option('--agent <type>', 'claude or codex', 'claude')
  .option('--label <label>', 'session label')
  .option('--resume [conversationId]', 'resume Claude conversation')
  .action(async (workDir, options) => {
    const api = createApi(program.opts());
    const resolved = path.resolve(workDir);
    const resume = options.resume === true ? true : options.resume || false;
    const session = await api.createSession({
      workDir: resolved,
      label: options.label || path.basename(resolved),
      agentType: options.agent === 'codex' ? 'codex' : 'claude',
      resume,
    });
    rememberFolder(resolved);
    console.log(JSON.stringify(session, null, 2));
  });

session
  .command('kill')
  .description('kill a backend PTY session')
  .argument('<sessionId>')
  .action(async (sessionId) => {
    const api = createApi(program.opts());
    await api.killSession(sessionId);
    console.log(`Kill requested for ${sessionId}`);
  });

program
  .command('upload')
  .description('upload a local file through the WebSocket file.upload protocol')
  .argument('<sessionId>')
  .argument('<localPath>')
  .argument('[remotePath]')
  .action(async (sessionId, localPath, remotePath) => {
    const upload = await readLocalUpload(localPath);
    const filePath = remotePath || upload.fileName;
    await withProtocolClient(program.opts(), async (client) => {
      await client.request(
        'file.upload',
        { sessionId, filePath, content: upload.content, encoding: upload.encoding },
        'file.uploaded',
        (payload) => payload.sessionId === sessionId && payload.filePath === filePath,
        30000,
      );
    });
    console.log(`Uploaded ${localPath} -> ${filePath} (${upload.size} bytes, ${upload.encoding})`);
  });

program
  .command('download')
  .description('download a remote file through the WebSocket file.download protocol')
  .argument('<sessionId>')
  .argument('<remotePath>')
  .argument('[localPath]')
  .option('--force', 'overwrite local destination')
  .action(async (sessionId, remotePath, localPath, options) => {
    const dest = path.resolve(localPath || path.basename(remotePath));
    if (!options.force && fsSync.existsSync(dest)) {
      throw new Error(`Refusing to overwrite ${dest}; pass --force to replace it`);
    }
    let payload;
    await withProtocolClient(program.opts(), async (client) => {
      payload = await client.request(
        'file.download',
        { sessionId, filePath: remotePath },
        'file.downloadReady',
        (response) => response.sessionId === sessionId && response.filePath === remotePath,
        30000,
      );
    });
    await fs.writeFile(dest, Buffer.from(payload.content, 'base64'));
    console.log(`Downloaded ${remotePath} -> ${dest} (${payload.size} bytes)`);
  });

const token = program.command('token').description('token commands for auth-enabled backends');

token
  .command('create')
  .description('create a backend token')
  .requiredOption('--name <name>', 'token name')
  .option('--role <role>', 'admin, operator, or viewer', 'operator')
  .action(async (options) => {
    const api = createApi(program.opts());
    const result = await api.createToken({ name: options.name, role: options.role });
    console.log(JSON.stringify(result, null, 2));
  });

token
  .command('list')
  .description('list backend tokens')
  .action(async () => {
    const api = createApi(program.opts());
    console.log(JSON.stringify(await api.listTokens(), null, 2));
  });

token
  .command('revoke')
  .description('revoke a backend token')
  .argument('<tokenId>')
  .action(async (tokenId) => {
    const api = createApi(program.opts());
    await api.revokeToken(tokenId);
    console.log(`Revoked ${tokenId}`);
  });

program.action(async () => {
  await runTui(program.opts());
});

try {
  await program.parseAsync(process.argv);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

async function promptToken() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question('Paste token: ')).trim();
  } finally {
    rl.close();
  }
}

async function withProtocolClient(options, fn) {
  const client = new ProtocolClient({ ...options, reconnect: false });
  client.connect();
  await client.waitForOpen();
  try {
    return await fn(client);
  } finally {
    client.close();
  }
}

function printSessions(sessions) {
  if (!sessions?.length) {
    console.log('No sessions');
    return;
  }
  for (const session of sessions) {
    console.log([
      session.id,
      session.state,
      session.agentType,
      session.label,
      session.workDir,
      session.createdAt,
    ].join('\t'));
  }
}
