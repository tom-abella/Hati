import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applePaySuggestions, duplicateCount, resolveHistoryDate } from '../lib/apple-pay.js';
import { accountDb } from '../lib/db.js';
import { addTransactions } from '../lib/sync.js';

test('history suggestions separate amounts, require dates and flag unconfirmed currency', () => {
  const rows = applePaySuggestions('Latest Transactions\nCafe ₱250.00\nToday\nGrab -PHP 1,234.50\nPending\nOnline $12.00\nShop 15.00');
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map(row => row.amount), ['250.00', '1234.50', '12.00', '15.00']);
  assert.deepEqual(rows.map(row => row.currency), ['PHP', 'PHP', '', '']);
  assert.ok(rows.every(row => row.date === ''));
  assert.match(rows[1].source, /Pending/);
  assert.equal(applePaySuggestions('Today\n10:30 AM').length, 0);
  assert.equal(applePaySuggestions('Cafe ₱5.00\nNov 10, 2026')[0].date, '2026-11-10');
  assert.equal(applePaySuggestions('Cafe ₱5.00\n2026-02-30')[0].date, '');
});

test('relative dates use the screenshot capture time and most recent earlier weekday', () => {
  assert.equal(resolveHistoryDate('Today', '2026-01-01T04:00'), '2026-01-01');
  assert.equal(resolveHistoryDate('Yesterday', '2026-01-01T04:00'), '2025-12-31');
  assert.equal(resolveHistoryDate('6 hours ago', '2026-01-01T04:00'), '2025-12-31');
  assert.equal(resolveHistoryDate('6 hours ago', '2026-01-01T23:00'), '2026-01-01');
  assert.equal(resolveHistoryDate('Sunday', '2026-11-12T10:00'), '2026-11-08');
  assert.equal(resolveHistoryDate('Saturday', '2026-11-12T10:00'), '2026-11-07');
  assert.equal(resolveHistoryDate('Thursday', '2026-11-12T10:00'), '');
  assert.equal(resolveHistoryDate('Yesterday', ''), '');
});

test('numeric dates require an explicit order when ambiguous and reject invalid dates', () => {
  assert.equal(resolveHistoryDate('11/4/26', ''), '');
  assert.equal(resolveHistoryDate('11/4/26', '', 'MDY'), '2026-11-04');
  assert.equal(resolveHistoryDate('11/4/26', '', 'DMY'), '2026-04-11');
  assert.equal(resolveHistoryDate('13/4/26', ''), '2026-04-13');
  assert.equal(resolveHistoryDate('02/30/26', '', 'MDY'), '');
  assert.equal(resolveHistoryDate('2/29/24', '', 'MDY'), '2024-02-29');
});

test('history rows associate adjacent date labels without borrowing a previous row date', () => {
  const rows = applePaySuggestions('Cafe ₱10.00\nYesterday\nGrab ₱20.00\n6 hours ago\nSunday Market ₱30.00', { capturedAt: '2026-11-12T04:00' });
  assert.equal(rows[0].date, '2026-11-11');
  assert.equal(rows[1].date, '2026-11-11');
  assert.equal(rows[1].dateLabel, '6 hours ago');
  assert.equal(rows[2].date, '');
  assert.equal(rows[2].merchant, 'Sunday Market');
  assert.equal(applePaySuggestions('Sunday\nCafe ₱10.00', { capturedAt: '2026-11-12T04:00' })[0].date, '2026-11-08');
});

test('duplicate warnings include existing transactions and repeats within the import', () => {
  const expense = { type: 'expense', date: '2026-11-10', amount: 1000 };
  assert.equal(duplicateCount([expense, { ...expense }, { ...expense, amount: 2000 }], [{ ...expense, amount: 2000 }]), 2);
  assert.equal(duplicateCount([{ ...expense, amount: 3000 }], [expense]), 0);
});

test('batch import queues all transactions atomically and rolls back on failure', async () => {
  const db = accountDb(crypto.randomUUID());
  const entry = { id: 'one', type: 'expense', amount: 1000, category: 'Food', date: '2026-11-10', account: 'Apple Pay', note: 'Cafe', card_id: '' };
  try {
    await addTransactions(db, [entry, { ...entry, id: 'two' }]);
    assert.equal(await db.transactions.count(), 2);
    assert.equal(await db.syncQueue.count(), 2);
    await assert.rejects(addTransactions(db, [{ ...entry, id: 'three' }, entry]));
    assert.equal(await db.transactions.count(), 2);
    assert.equal(await db.syncQueue.count(), 2);
  } finally { await db.delete(); }
});
