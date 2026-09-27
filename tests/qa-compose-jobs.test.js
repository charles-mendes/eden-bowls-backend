const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const composePath = path.join(__dirname, '../docker-compose.qa.yml');
const envExamplePath = path.join(__dirname, '../.env.example');

function serviceBlock(text, name) {
  const match = text.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z]|\\nvolumes:)`, 'm'));
  return match ? match[1] : '';
}

describe('QA compose background jobs', () => {
  test('the compose file parses, the API stays MODE=http without the jobs flag, and cron does not publish a port', () => {
    const text = fs.readFileSync(composePath, 'utf8');
    execFileSync('docker', ['compose', '-f', composePath, 'config'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const api = serviceBlock(text, 'api');
    const cron = serviceBlock(text, 'cron');
    expect(api).toContain('MODE: http');
    expect(api).not.toContain('ENABLE_BACKGROUND_JOBS');
    expect(cron).toContain('MODE: cron');
    expect(cron).not.toMatch(/^\s*ports:/m);

    const example = fs.readFileSync(envExamplePath, 'utf8');
    expect(example).toMatch(/^MODE=http$/m);
    expect(example).toContain('ENABLE_BACKGROUND_JOBS');
  });
});