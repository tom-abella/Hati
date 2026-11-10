import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Dexie from 'dexie';
import { accountDb } from '../lib/db.js';
import { addTransaction, deleteTransaction } from '../lib/sync.js';

const entry = { id: 'a', type: 'expense', amount: 123, category: 'Food', date: '2026-11-10', account: '', note: '' };

test('transaction writes and deletes are queued atomically', async () => {
  const db = accountDb(crypto.randomUUID());
  try {
    await addTransaction(db, entry);
    await assert.rejects(addTransaction(db, entry));
    assert.equal(await db.transactions.count(), 1);
    assert.equal(await db.syncQueue.count(), 1);
    await deleteTransaction(db, entry.id);
    assert.equal(await db.transactions.count(), 0);
    assert.deepEqual((await db.syncQueue.toArray()).map(op => op.kind), ['create', 'delete']);
  } finally { await db.delete(); }
});

test('upgrading preserves and queues existing local transactions', async () => {
  const id = crypto.randomUUID();
  const old = new Dexie(`hati-account-${id}`);
  old.version(3).stores({ transactions: 'id,date,type,category', reminders: 'id,dueDate,paid', imageDrafts: 'id,createdAt', documents: 'id,type,date,dueDate' });
  await old.transactions.add(entry);
  old.close();
  const db = accountDb(id);
  try {
    assert.deepEqual(await db.transactions.get(entry.id), entry);
    assert.equal((await db.syncQueue.toArray())[0].recordId, entry.id);
  } finally { await db.delete(); }
});
