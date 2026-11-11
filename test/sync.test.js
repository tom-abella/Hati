import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Dexie from 'dexie';
import { accountDb } from '../lib/db.js';
import { addCard, addReminder, addTransaction, deleteTransaction, documentPayload, setReminderPaid, syncTransactions, updateCard, updateReminder } from '../lib/sync.js';

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

test('upgrading queues existing cards and new cards are queued atomically', async () => {
  const id = crypto.randomUUID();
  const old = new Dexie(`hati-account-${id}`);
  old.version(5).stores({ transactions: 'id,date,type,category', reminders: 'id,dueDate,paid', imageDrafts: 'id,createdAt', documents: 'id,type,date,dueDate', syncQueue: '++seq,recordId', syncMeta: 'key', cards: 'id' });
  const card = { id: 'old', name: 'Visa', limit: 100000 };
  await old.cards.add(card);
  old.close();
  const db = accountDb(id);
  try {
    assert.deepEqual(await db.cards.get(card.id), card);
    assert.deepEqual((await db.syncQueue.toArray()).map(op => op.kind), ['card-create']);
    await addCard(db, { id: 'new', name: 'New card', limit: 50000 });
    await assert.rejects(addCard(db, card));
    assert.equal(await db.syncQueue.count(), 2);
  } finally { await db.delete(); }
});

test('card sync uploads queued cards, downloads cards, and keeps conflicts queued', async () => {
  const db = accountDb(crypto.randomUUID());
  const remote = [{ id: 'remote', user_id: 'user', name: 'Remote', credit_limit: 30000 }];
  const client = {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'user' } } } }) },
    from(table) {
      let id, row, single = false;
      const query = {
        select() { return this; }, upsert(value) { row = value; return this; },
        eq(key, value) { if (key === 'id') id = value; return this; },
        order() { return this; }, limit() { return this; }, abortSignal() { return this; }, maybeSingle() { single = true; return this; },
        then(resolve, reject) {
          if (table === 'cards' && row && !remote.some(card => card.id === row.id)) remote.push(row);
          const cards = remote.filter(card => card.user_id === 'user' && (!id || card.id === id));
          return Promise.resolve({ data: table === 'cards' ? (single ? cards[0] || null : cards) : [], error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  try {
    await addCard(db, { id: 'local', name: 'Local', limit: 50000 });
    await syncTransactions(db, 'user', new AbortController().signal, client);
    assert.equal(await db.syncQueue.count(), 0);
    assert.deepEqual(await db.cards.get('remote'), { id: 'remote', name: 'Remote', limit: 30000 });
    assert.equal(remote.find(card => card.id === 'local').credit_limit, 50000);
    await addCard(db, { id: 'conflict', name: 'Local version', limit: 100 });
    remote.push({ id: 'conflict', user_id: 'user', name: 'Other version', credit_limit: 100 });
    await assert.rejects(syncTransactions(db, 'user', new AbortController().signal, client), /conflicts/);
    assert.equal(await db.syncQueue.count(), 1);
    assert.equal((await db.cards.get('conflict')).name, 'Local version');
  } finally { await db.delete(); }
});

test('card edits and removals sync without deleting linked transactions', async () => {
  const first = accountDb(crypto.randomUUID());
  const second = accountDb(crypto.randomUUID());
  const remote = { cards: [], transactions: [], documents: [], payment_reminders: [] };
  const client = {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'user' } } } }) },
    from(table) {
      let filters = [], inserted, changes, single = false;
      return {
        select() { return this; }, upsert(value) { inserted = value; return this; }, update(value) { changes = value; return this; },
        eq(key, value) { filters.push(row => row[key] === value); return this; }, is(key, value) { filters.push(row => (row[key] ?? null) === value); return this; },
        order() { return this; }, limit() { return this; }, abortSignal() { return this; }, maybeSingle() { single = true; return this; },
        then(resolve, reject) {
          const rows = remote[table];
          if (inserted && !rows.some(row => row.id === inserted.id)) rows.push({ ...inserted });
          const found = rows.filter(row => filters.every(filter => filter(row)));
          if (changes) found.forEach(row => Object.assign(row, changes));
          return Promise.resolve({ data: single ? found[0] || null : found, error: null }).then(resolve, reject);
        },
      };
    },
  };
  const signal = new AbortController().signal;
  try {
    await addCard(first, { id: 'c', name: 'Visa', limit: 10000 });
    await syncTransactions(first, 'user', signal, client);
    await syncTransactions(second, 'user', signal, client);
    await updateCard(first, 'c', { name: 'Updated', limit: 20000 });
    await syncTransactions(first, 'user', signal, client);
    await syncTransactions(second, 'user', signal, client);
    assert.equal((await second.cards.get('c')).name, 'Updated');
    await second.transactions.add({ ...entry, card_id: 'c' });
    await updateCard(second, 'c', { deletedAt: '2026-11-11T00:00:00.000Z' });
    await syncTransactions(second, 'user', signal, client);
    await syncTransactions(first, 'user', signal, client);
    assert.ok((await first.cards.get('c')).deletedAt);
    assert.equal((await second.transactions.get('a')).card_id, 'c');
    await assert.rejects(updateCard(second, 'c', { name: 'Again' }), /no longer available/);
  } finally { await first.delete(); await second.delete(); }
});

test('upgrading queues reminders and document details without image data', async () => {
  const id = crypto.randomUUID();
  const old = new Dexie(`hati-account-${id}`);
  old.version(6).stores({ transactions: 'id,date,type,category', reminders: 'id,dueDate,paid', imageDrafts: 'id,createdAt', documents: 'id,type,date,dueDate', syncQueue: '++seq,recordId', syncMeta: 'key', cards: 'id' });
  await old.reminders.add({ id: 'r', title: 'Payment', dueDate: '2026-11-10', paid: false });
  await old.documents.add({ id: 'd', type: 'bill', merchant: 'Store', date: '2026-11-01', dueDate: '2026-11-10', amount: 100, currency: 'PHP', image: new Blob(['image']) });
  old.close();
  const db = accountDb(id);
  try {
    const ops = await db.syncQueue.toArray();
    assert.equal(ops.length, 2);
    const document = ops.find(op => op.kind === 'document-create').record;
    assert.equal('image' in document, false);
    assert.equal(documentPayload(document).due_date, '2026-11-10');
    assert.ok((await db.documents.get('d')).image);
    const reminder = ops.find(op => op.kind === 'reminder-save');
    assert.equal(reminder.previousVersion, null);
    assert.equal(reminder.record.syncVersion, (await db.reminders.get('r')).syncVersion);
  } finally { await db.delete(); }
});

test('payment and undo queue ordered versions and repeated actions are idempotent', async () => {
  const db = accountDb(crypto.randomUUID());
  try {
    await addReminder(db, { id: 'r', title: 'Card', dueDate: '2026-11-10', paid: false, cardId: 'c', amount: 100 });
    await setReminderPaid(db, 'r', true);
    await setReminderPaid(db, 'r', true);
    await setReminderPaid(db, 'r', false);
    const ops = await db.syncQueue.toArray();
    assert.equal(ops.length, 3);
    assert.equal(ops[1].previousVersion, ops[0].record.syncVersion);
    assert.equal(ops[2].previousVersion, ops[1].record.syncVersion);
    assert.equal((await db.reminders.get('r')).paid, false);
  } finally { await db.delete(); }
});

test('reminders and document details sync across devices and retain conflicting local changes', async () => {
  const first = accountDb(crypto.randomUUID());
  const second = accountDb(crypto.randomUUID());
  const third = accountDb(crypto.randomUUID());
  const remote = { documents: [], payment_reminders: [], cards: [], transactions: [] };
  const client = {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'user' } } } }) },
    from(table) {
      let id, row, single = false;
      return {
        select() { return this; }, upsert(value) { row = value; return this; },
        eq(key, value) { if (key === 'id') id = value; return this; }, order() { return this; }, limit() { return this; }, abortSignal() { return this; }, maybeSingle() { single = true; return this; },
        then(resolve, reject) {
          const records = remote[table];
          if (row && !records.some(record => record.id === row.id)) records.push(row);
          const found = records.filter(record => !id || record.id === id);
          return Promise.resolve({ data: single ? found[0] || null : found, error: null }).then(resolve, reject);
        },
      };
    },
    rpc(_name, p) {
      const current = remote.payment_reminders.find(item => item.id === p.p_id);
      const conflict = current && current.version !== p.p_version && current.version !== p.p_previous_version;
      if (!conflict && (!current || current.version !== p.p_version)) {
        const next = { id: p.p_id, title: p.p_title, due_date: p.p_due_date, paid: p.p_paid, card_id: p.p_card_id, amount: p.p_amount, send_at: p.p_send_at, version: p.p_version, deleted_at: p.p_deleted ? '2026-11-11T00:00:00Z' : null };
        if (current) Object.assign(current, next); else remote.payment_reminders.push(next);
      }
      return { abortSignal: async () => ({ error: conflict ? new Error('Reminder conflict') : null }) };
    },
  };
  const signal = new AbortController().signal;
  try {
    const document = { id: 'document', type: 'bill', merchant: 'Store', date: '2026-11-01', dueDate: '2026-11-10', amount: 100, currency: 'PHP', name: 'receipt' };
    await first.documents.add(document);
    await first.syncQueue.add({ recordId: document.id, kind: 'document-create', record: documentPayload(document) });
    await addReminder(first, { id: 'reminder', title: 'Card', dueDate: '2026-11-10', paid: false, cardId: 'card', amount: 100, sendAt: '' });
    await syncTransactions(first, 'user', signal, client);
    await syncTransactions(second, 'user', signal, client);
    assert.deepEqual(await second.documents.get('document'), document);
    assert.equal((await second.reminders.get('reminder')).paid, false);
    const originalVersion = (await first.reminders.get('reminder')).syncVersion;
    await updateReminder(first, 'reminder', { title: 'Updated card', amount: 200 }, originalVersion);
    await syncTransactions(first, 'user', signal, client);
    await syncTransactions(second, 'user', signal, client);
    assert.equal((await second.reminders.get('reminder')).title, 'Updated card');
    await assert.rejects(updateReminder(first, 'reminder', { title: 'Old edit' }, originalVersion), /changed/);
    await setReminderPaid(first, 'reminder', true);
    await syncTransactions(first, 'user', signal, client);
    await setReminderPaid(second, 'reminder', true);
    await assert.rejects(syncTransactions(second, 'user', signal, client), /conflict/);
    assert.equal((await second.reminders.get('reminder')).paid, true);
    assert.equal(await second.syncQueue.count(), 1);
    await updateReminder(first, 'reminder', { deleted: true });
    await syncTransactions(first, 'user', signal, client);
    await syncTransactions(third, 'user', signal, client);
    assert.equal((await third.reminders.get('reminder')).deleted, true);
    await assert.rejects(updateReminder(first, 'reminder', { title: 'Again' }), /no longer exists/);
  } finally { await first.delete(); await second.delete(); await third.delete(); }
});
