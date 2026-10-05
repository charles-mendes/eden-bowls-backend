// Dev only: starts the API (node --watch) and one `stripe listen` per account.
// Each listener's whsec_ is written to .local/stripe-webhook-secrets.json, which
// StripeAccounts reads on every webhook POST when NODE_ENV=development.
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });

const IS_WINDOWS = process.platform === 'win32';
const PORT = process.env.PORT || '3000';
const SECRETS_FILE = process.env.STRIPE_WEBHOOK_SECRETS_FILE
  || path.join(ROOT, '.local', 'stripe-webhook-secrets.json');
const SECRETS_FILE_LABEL = path.relative(ROOT, SECRETS_FILE).startsWith('..')
  ? SECRETS_FILE
  : path.relative(ROOT, SECRETS_FILE);
const SECRET_PATTERN = /whsec_[A-Za-z0-9]+/;
const RESTART_DELAY_MS = 2000;
const MAX_QUICK_RESTARTS = 5;
const QUICK_EXIT_MS = 10 * 1000;

const children = new Set();
let shuttingDown = false;

function log(tag, message) {
  process.stdout.write(`[${tag}] ${message}\n`);
}

function maskSecret(secret) {
  const body = secret.slice('whsec_'.length);
  return `whsec_${body.slice(0, 3)}…${body.slice(-3)}`;
}

function pipeWithPrefix(stream, tag, target, onLine) {
  const lines = readline.createInterface({ input: stream });
  lines.on('line', (line) => {
    if (onLine) {
      onLine(line);
    }
    target.write(`[${tag}] ${line.replace(SECRET_PATTERN, (match) => maskSecret(match))}\n`);
  });
}

function findExecutable(name) {
  const extensions = IS_WINDOWS
    ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';').filter(Boolean)
    : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) {
      continue;
    }
    for (const ext of extensions) {
      const candidate = path.join(dir, name + ext.toLowerCase());
      try {
        if (fs.statSync(candidate).isFile()) {
          return candidate;
        }
      } catch {
        // not here
      }
    }
  }
  return null;
}

function readSecretsFile() {
  try {
    const parsed = JSON.parse(fs.readFileSync(SECRETS_FILE, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function saveSecret(account, secret) {
  if (shuttingDown) {
    return false;
  }
  const current = readSecretsFile();
  if (current[account] === secret) {
    return false;
  }
  fs.mkdirSync(path.dirname(SECRETS_FILE), { recursive: true });
  const tmp = `${SECRETS_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ ...current, [account]: secret }, null, 2)}\n`);
  fs.renameSync(tmp, SECRETS_FILE);
  return true;
}

function killTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  if (IS_WINDOWS) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

// The session secrets die with the listeners. Removing the file lets
// `npm run dev:api` fall back to the .env secrets.
function removeSecretsFile() {
  for (const file of [SECRETS_FILE, `${SECRETS_FILE}.${process.pid}.tmp`]) {
    try {
      fs.rmSync(file, { force: true });
    } catch (error) {
      log('dev', `Could not remove ${file}: ${error.message}`);
    }
  }
}

function shutdown(exitCode) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  removeSecretsFile();
  for (const child of children) {
    killTree(child);
  }
  // Give children a moment to exit, then force them.
  setTimeout(() => {
    for (const child of children) {
      if (!IS_WINDOWS && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
    }
    process.exit(exitCode);
  }, 1500).unref();
  if (children.size === 0) {
    process.exit(exitCode);
  }
}

function track(child, onExit) {
  children.add(child);
  child.on('exit', (code, signal) => {
    children.delete(child);
    onExit(code, signal);
    if (shuttingDown && children.size === 0) {
      process.exit(process.exitCode || 0);
    }
  });
}

function startApi() {
  const env = { ...process.env, NODE_ENV: 'development' };
  if (process.stdout.isTTY && !env.NO_COLOR) {
    env.FORCE_COLOR = env.FORCE_COLOR || '1';
  }
  // DEV_API_ENTRY exists for tests/dev-with-stripe-listen.test.js.
  const api = spawn(process.execPath, ['--watch', process.env.DEV_API_ENTRY || 'src/index.js'], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  pipeWithPrefix(api.stdout, 'api', process.stdout);
  pipeWithPrefix(api.stderr, 'api', process.stderr);
  track(api, (code, signal) => {
    if (!shuttingDown) {
      log('dev', `API exited (${signal || code}). Stopping Stripe listeners.`);
      process.exitCode = code || 0;
      shutdown(code || 0);
    }
  });
}

function startListener(stripeBin, account, apiKey, state = { quickExits: 0 }) {
  const tag = `stripe-${account}`;
  const startedAt = Date.now();
  // Node refuses to spawn .cmd/.bat shims without a shell on Windows.
  const useShell = IS_WINDOWS && /\.(cmd|bat)$/i.test(stripeBin);
  const listener = spawn(useShell ? `"${stripeBin}"` : stripeBin, ['listen', '--forward-to', `localhost:${PORT}/stripe/v1/webhook/${account}`], {
    cwd: ROOT,
    env: { ...process.env, STRIPE_API_KEY: apiKey },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    shell: useShell
  });

  const onLine = (line) => {
    const match = line.match(SECRET_PATTERN);
    if (!match) {
      return;
    }
    try {
      if (saveSecret(account, match[0])) {
        log(tag, `Webhook secret ${maskSecret(match[0])} saved to ${SECRETS_FILE_LABEL}.`);
      }
    } catch (error) {
      log(tag, `Could not save the webhook secret: ${error.message}`);
    }
  };
  // The CLI prints the secret on stderr; read both streams.
  pipeWithPrefix(listener.stdout, tag, process.stdout, onLine);
  pipeWithPrefix(listener.stderr, tag, process.stderr, onLine);

  listener.on('error', (error) => {
    log(tag, `Could not start stripe listen: ${error.message}`);
  });

  track(listener, (code, signal) => {
    if (shuttingDown) {
      return;
    }
    state.quickExits = Date.now() - startedAt < QUICK_EXIT_MS ? state.quickExits + 1 : 0;
    if (state.quickExits >= MAX_QUICK_RESTARTS) {
      log(tag, `stripe listen keeps exiting (${signal || code}). Not restarting; the API keeps running.`);
      return;
    }
    log(tag, `stripe listen exited (${signal || code}). Restarting in ${RESTART_DELAY_MS / 1000}s.`);
    setTimeout(() => {
      if (!shuttingDown) {
        startListener(stripeBin, account, apiKey, state);
      }
    }, RESTART_DELAY_MS);
  });
}

function main() {
  process.on('exit', removeSecretsFile);
  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));

  startApi();

  const stripeBin = findExecutable('stripe');
  if (!stripeBin) {
    log('dev', 'Stripe CLI not found in PATH. The API is running without webhook listeners.');
    log('dev', 'Install it: https://docs.stripe.com/stripe-cli (macOS: brew install stripe/stripe-cli/stripe; Windows: scoop install stripe).');
    return;
  }

  const accounts = [
    { account: 'us', keyName: 'STRIPE_US_SECRET_KEY' },
    { account: 'br', keyName: 'STRIPE_BR_SECRET_KEY' }
  ];
  for (const { account, keyName } of accounts) {
    const apiKey = (process.env[keyName] || '').trim();
    if (!apiKey) {
      log('dev', `${keyName} is empty. Skipping the ${account.toUpperCase()} Stripe listener.`);
      continue;
    }
    startListener(stripeBin, account, apiKey);
  }
}

main();
