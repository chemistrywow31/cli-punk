import { spawn } from 'node:child_process';
import net from 'node:net';

const rootDir = process.env.ROOT_DIR;
const port = Number(process.env.PORT);
const frontendPort = Number(process.env.FRONTEND_PORT);
const serverUrl = process.env.SERVER_URL;
const frontendUrl = process.env.FRONTEND_URL;
const noOpen = process.env.NO_OPEN === '1';
const children = [];
let shuttingDown = false;
let shutdownPromise = null;
let rawModeEnabled = false;

await main().catch(async (error) => {
  console.error(error?.message || error);
  await shutdown(1);
});

async function main() {
  await assertPortFree(port, 'backend');
  await assertPortFree(frontendPort, 'frontend');
  enableInterruptKeys();

  const backend = spawnManaged('backend', process.execPath, [`${rootDir}/backend/server.js`], {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, PORT: String(port) },
  });

  await waitForUrl(`${serverUrl}/health`, backend, 10_000, 'backend');
  console.log(`Backend ready: ${serverUrl}`);

  const frontend = spawnManaged('frontend', process.execPath, [
    `${rootDir}/node_modules/vite/bin/vite.js`,
    '--host',
    '127.0.0.1',
    '--port',
    String(frontendPort),
    '--strictPort',
  ], {
    cwd: `${rootDir}/frontend`,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: {
      ...process.env,
      BACKEND_PORT: String(port),
    },
  });

  await waitForUrl(frontendUrl, frontend, 20_000, 'frontend');
  console.log('');
  console.log(`Web app: ${frontendUrl}`);
  console.log(`Backend: ${serverUrl}`);
  console.log('Stop: Ctrl+C');
  console.log('');

  if (!noOpen) openBrowser(frontendUrl);

  const { label, code, signal } = await waitForAnyExit([
    ['backend', backend],
    ['frontend', frontend],
  ]);
  const status = code ?? signalExitCode(signal) ?? 1;
  if (!shuttingDown) {
    console.error(`${label} exited${signal ? ` by ${signal}` : ` with code ${status}`}; stopping the stack.`);
  }
  await shutdown(status);
}

function spawnManaged(label, command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: rootDir,
    env: process.env,
    stdio: 'inherit',
    ...options,
  });
  child.label = label;
  child.on('error', (error) => {
    console.error(`${label} failed to start: ${error.message}`);
  });
  children.push(child);
  return child;
}

function enableInterruptKeys() {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') return;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  rawModeEnabled = true;
  process.stdin.on('data', (chunk) => {
    if (!chunk.includes(3)) return;
    console.log('');
    console.log('Stopping Claude Punk...');
    shutdown(130);
  });
}

function assertPortFree(targetPort, label) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        reject(new Error(`${label} port ${targetPort} is already in use. Stop that process first; start.sh does not attach to existing services or switch ports.`));
        return;
      }
      reject(error);
    });
    probe.once('listening', () => {
      probe.close(resolve);
    });
    probe.listen(targetPort, '127.0.0.1');
  });
}

async function waitForUrl(url, child, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode) {
      throw new Error(`${label} exited before becoming ready.`);
    }
    if (await urlIsReady(url)) return;
    await delay(250);
  }
  throw new Error(`${label} did not become ready at ${url}.`);
}

async function urlIsReady(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(750) });
    return response.ok;
  } catch {
    return false;
  }
}

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode) {
    return Promise.resolve(child.exitCode ?? signalExitCode(child.signalCode) ?? 1);
  }
  return new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve(code ?? signalExitCode(signal) ?? 1));
  });
}

function waitForAnyExit(entries) {
  return Promise.race(entries.map(([label, child]) => {
    if (child.exitCode !== null || child.signalCode) {
      return Promise.resolve({ label, code: child.exitCode, signal: child.signalCode });
    }
    return new Promise((resolve) => {
      child.once('exit', (code, signal) => resolve({ label, code, signal }));
    });
  }));
}

async function shutdown(status = 0) {
  if (shutdownPromise) return shutdownPromise;
  shuttingDown = true;

  shutdownPromise = (async () => {
    for (const child of [...children].reverse()) {
      await stopChild(child);
    }
    restoreTerminal();
    process.exit(status);
  })();
  return shutdownPromise;
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode) return;

  await Promise.race([
    waitForExit(child),
    delay(750),
  ]);
  if (child.exitCode !== null || child.signalCode) return;

  child.kill('SIGTERM');
  await Promise.race([
    waitForExit(child),
    delay(5_000),
  ]);
  if (child.exitCode === null && !child.signalCode) child.kill('SIGKILL');
}

function signalExitCode(signal) {
  if (!signal) return null;
  const signalNumbers = {
    SIGHUP: 1,
    SIGINT: 2,
    SIGTERM: 15,
  };
  return signalNumbers[signal] ? 128 + signalNumbers[signal] : 1;
}

function restoreTerminal() {
  if (!rawModeEnabled) return;
  try {
    process.stdin.setRawMode(false);
  } catch {
    // ignore terminal restore failures during shutdown
  }
  rawModeEnabled = false;
}

function openBrowser(url) {
  const command = process.platform === 'darwin'
    ? 'open'
    : process.platform === 'win32'
      ? 'cmd'
      : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const opener = spawn(command, args, { stdio: 'ignore' });
  opener.on('error', () => {});
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

process.on('SIGINT', () => {
  console.log('');
  console.log('Stopping Claude Punk...');
  shutdown(130);
});

process.on('SIGTERM', () => {
  shutdown(143);
});
