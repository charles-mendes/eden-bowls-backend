const request = require('supertest');
const { createApp } = require('../src/app');
const { recordJobItemsFailed } = require('../src/core/job-metrics');

describe('background job metrics', () => {
  test('a failed item increments the counter and /metrics still responds', async () => {
    recordJobItemsFailed('webhook_retry', 2);
    const app = createApp({ nodeEnv: 'development' });
    const response = await request(app).get('/metrics');

    expect(response.status).toBe(200);
    expect(response.text).toContain('eden_job_items_failed_total');
    expect(response.text).toContain('eden_job_last_success_timestamp');
    expect(response.text).toMatch(/eden_job_items_failed_total\{job="webhook_retry"\} [1-9]/);
  });
});
