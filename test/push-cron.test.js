import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GET } from '../app/api/cron/send-reminders/route.js';

test('cron rejects absent or incorrect secrets without contacting Supabase', async () => {
  const old = process.env.CRON_SECRET;
  try {
    process.env.CRON_SECRET = 'test-secret';
    assert.equal((await GET(new Request('http://localhost/api/cron/send-reminders'))).status, 401);
    assert.equal((await GET(new Request('http://localhost/api/cron/send-reminders', { headers: { Authorization: 'Bearer wrong' } }))).status, 401);
    delete process.env.CRON_SECRET;
    assert.equal((await GET(new Request('http://localhost/api/cron/send-reminders', { headers: { Authorization: 'Bearer undefined' } }))).status, 401);
  } finally { if (old === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = old; }
});
