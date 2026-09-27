const fs = require('fs');
const path = require('path');
const { startProcess } = require('../src/core/process-mode');

function start(env) {
  const listen = jest.fn(() => ({ on: jest.fn() }));
  const onSchedule = jest.fn();
  const result = startProcess({
    app: { listen },
    env: { PORT: 3000, ...env },
    logger: { info: jest.fn(), error: jest.fn() },
    onSchedule
  });
  return { listen, onSchedule, result };
}

describe('bootstrap runtime', () => {
  test('MODE=http without ENABLE_BACKGROUND_JOBS only listens', () => {
    const { listen, onSchedule } = start({ MODE: 'http', ENABLE_BACKGROUND_JOBS: false });
    expect(listen).toHaveBeenCalledWith(3000, expect.any(Function));
    expect(onSchedule).not.toHaveBeenCalled();
  });

  test('MODE=cron schedules and does not listen', () => {
    const { listen, onSchedule } = start({ MODE: 'cron' });
    expect(listen).not.toHaveBeenCalled();
    expect(onSchedule).toHaveBeenCalledTimes(1);
  });

  test('MODE=worker schedules and does not listen', () => {
    const { listen, onSchedule } = start({ MODE: 'worker' });
    expect(listen).not.toHaveBeenCalled();
    expect(onSchedule).toHaveBeenCalledTimes(1);
  });

  test('MODE=all and ENABLE_BACKGROUND_JOBS both listen and schedule', () => {
    const all = start({ MODE: 'all', ENABLE_BACKGROUND_JOBS: false });
    expect(all.listen).toHaveBeenCalled();
    expect(all.onSchedule).toHaveBeenCalled();

    const flagged = start({ MODE: 'http', ENABLE_BACKGROUND_JOBS: true });
    expect(flagged.listen).toHaveBeenCalled();
    expect(flagged.onSchedule).toHaveBeenCalled();
  });

  test('index.js starts through startProcess instead of listening directly', () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/index.js'), 'utf8');
    expect(source).toContain('startProcess(');
    expect(source).not.toContain('app.listen(');
  });
});
