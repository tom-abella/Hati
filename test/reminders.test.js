import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paymentStatus, reminderSendAt } from '../lib/reminders.js';

test('payment checklist distinguishes upcoming, due, overdue and paid', () => {
  const item = { dueDate: '2026-02-28', paid: false };
  assert.equal(paymentStatus(item, '2026-02-27'), 'Upcoming');
  assert.equal(paymentStatus(item, '2026-02-28'), 'Due today');
  assert.equal(paymentStatus(item, '2026-03-01'), 'Overdue');
  assert.equal(paymentStatus({ ...item, paid: true }, '2026-03-01'), 'Paid');
});

test('notification times are converted from Manila to UTC and invalid dates are rejected', () => {
  assert.equal(reminderSendAt('2026-11-10', '08:30'), '2026-11-10T00:30:00.000Z');
  assert.equal(reminderSendAt('2026-11-10', '00:15'), '2026-11-09T16:15:00.000Z');
  assert.throws(() => reminderSendAt('2026-02-30', '08:30'));
  assert.throws(() => reminderSendAt('2026-11-10', '24:00'));
});
