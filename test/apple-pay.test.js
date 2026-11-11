import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applePaySuggestions, duplicateCount } from '../lib/apple-pay.js';
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
