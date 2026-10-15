const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.resolve(__dirname, '../scripts/dev-with-stripe-listen.js');

// The fake CLI is a POSIX shell script; Windows is covered manually.
const describePosix = process.platform === 'win32' ? describe.skip : describe;

async function waitFor(check, timeoutMs = 10000) {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('timed out');
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describePosix('dev-with-stripe-listen shutdown', () => {
  let dir;
  let secretsFile;
  let running;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-stripe-listen-'));
    secretsFile = path.join(dir, '.local', 'stripe-webhook-secrets.json');

    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'stripe'), [
      '#!/bin/sh',
      'echo "Ready! Your webhook signing secret is whsec_fake$$ (^C to quit)" >&2',
      'exec sleep 300',
      ''
    ].join('\n'), { mode: 0o755 });

    fs.writeFileSync(path.join(dir, 'api.js'), [
      // Under node --watch the parent is the watcher, i.e. the "API" process the script tracks.
      "if (process.env.FAKE_API_EXIT) setTimeout(() => process.kill(process.ppid, 'SIGTERM'), 1500);",
      'else setInterval(() => {}, 1000);',
      ''
    ].join('\n'));
  });

  afterEach(() => {
    if (running && running.exitCode === null && running.signalCode === null) {
      running.kill('SIGKILL');
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function start(extraEnv = {}) {
    const child = spawn(process.execPath, [SCRIPT], {
      env: {
        ...process.env,
        PATH: `${path.join(dir, 'bin')}${path.delimiter}${process.env.PATH}`,
        DEV_API_ENTRY: path.join(dir, 'api.js'),
        STRIPE_WEBHOOK_SECRETS_FILE: secretsFile,
        STRIPE_US_SECRET_KEY: 'sk_test_fake',
        STRIPE_BR_SECRET_KEY: '',
        ...extraEnv
      },
      stdio: 'ignore'
    });
    running = child;
    const exited = new Promise((resolve) => child.on('exit', resolve));
    return { child, exited };
  }

  test.each(['SIGINT', 'SIGTERM'])('removes the secrets file on %s', async (signal) => {
    const { child, exited } = start();
    await waitFor(() => fs.existsSync(secretsFile));
    expect(JSON.parse(fs.readFileSync(secretsFile, 'utf8')).us).toMatch(/^whsec_fake/);

    child.kill(signal);
    await exited;

    expect(fs.existsSync(secretsFile)).toBe(false);
  }, 20000);

  test('removes the secrets file when the API exits', async () => {
    const { exited } = start({ FAKE_API_EXIT: '1' });
    await waitFor(() => fs.existsSync(secretsFile));

    await exited;

    expect(fs.existsSync(secretsFile)).toBe(false);
  }, 20000);
});
