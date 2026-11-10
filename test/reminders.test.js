import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paymentStatus } from '../lib/reminders.js';

test('payment checklist distinguishes upcoming, due, overdue and paid', () => {
  const item = { dueDate: '2026-02-28', paid: false };
  assert.equal(paymentStatus(item, '2026-02-27'), 'Upcoming');
  assert.equal(paymentStatus(item, '2026-02-28'), 'Due today');
  assert.equal(paymentStatus(item, '2026-03-01'), 'Overdue');
  assert.equal(paymentStatus({ ...item, paid: true }, '2026-03-01'), 'Paid');
});
