import { supabase } from './supabase.js';

const fields = ['id', 'type', 'amount', 'category', 'date', 'account', 'note', 'card_id'];
const inFlight = new Map();

export function transactionPayload(record) {
  return Object.fromEntries(fields.map(key => [key, record[key] ?? '']));
}

export function documentPayload(record) {
  return { id: record.id, type: record.type, merchant: record.merchant, date: record.date, due_date: record.dueDate || record.due_date || '', amount: record.amount, currency: record.currency, name: record.name || '' };
}

export async function addTransaction(db, record) {
  await db.transaction('rw', db.transactions, db.syncQueue, async () => {
    await db.transactions.add(record);
    await db.syncQueue.add({ recordId: record.id, kind: 'create', record: transactionPayload(record) });
  });
}

export async function addTransactions(db, records) {
  await db.transaction('rw', db.transactions, db.syncQueue, async () => {
    await db.transactions.bulkAdd(records);
    await db.syncQueue.bulkAdd(records.map(record => ({ recordId: record.id, kind: 'create', record: transactionPayload(record) })));
  });
}

export async function addCard(db, record) {
  await db.transaction('rw', db.cards, db.syncQueue, async () => {
    await db.cards.add(record);
    await db.syncQueue.add({ recordId: record.id, kind: 'card-create', record });
  });
}

export async function updateCard(db, id, changes, expected) {
  await db.transaction('rw', db.cards, db.syncQueue, async () => {
    const previous = await db.cards.get(id);
    if (!previous || previous.deletedAt) throw new Error('This card is no longer available.');
    if (expected && (previous.name !== expected.name || previous.limit !== expected.limit)) throw new Error('This card changed. Reopen it and try again.');
    const record = { ...previous, ...changes };
    if (record.name === previous.name && record.limit === previous.limit && !record.deletedAt) return;
    await db.cards.put(record);
    await db.syncQueue.add({ recordId: id, kind: 'card-update', record, previous: { name: previous.name, limit: previous.limit } });
  });
}

export async function addReminder(db, reminder) {
  const record = { ...reminder, syncVersion: crypto.randomUUID() };
  await db.transaction('rw', db.reminders, db.syncQueue, async () => {
    await db.reminders.add(record);
    await db.syncQueue.add({ recordId: record.id, kind: 'reminder-save', record, previousVersion: null });
  });
}

export async function updateReminder(db, id, changes, expectedVersion) {
  await db.transaction('rw', db.reminders, db.syncQueue, async () => {
    const reminder = await db.reminders.get(id);
    if (!reminder || reminder.deleted) throw new Error('This reminder no longer exists.');
    if (expectedVersion && reminder.syncVersion !== expectedVersion) throw new Error('This reminder changed. Reopen it and try again.');
    if (Object.entries(changes).every(([key, value]) => reminder[key] === value)) return;
    const record = { ...reminder, ...changes, syncVersion: crypto.randomUUID() };
    await db.reminders.put(record);
    await db.syncQueue.add({ recordId: id, kind: 'reminder-save', record, previousVersion: reminder.syncVersion });
  });
}

export async function setReminderPaid(db, id, paid) {
  return updateReminder(db, id, { paid });
}

export async function deleteTransaction(db, id) {
  await db.transaction('rw', db.transactions, db.syncQueue, async () => {
    await db.transactions.delete(id);
    await db.syncQueue.add({ recordId: id, kind: 'delete' });
  });
}

async function run(db, userId, signal, client) {
  if (!client) throw new Error('Supabase is not configured.');
  const { data: { session } } = await client.auth.getSession();
  if (!session || session.user.id !== userId) throw new Error('Sign in again to sync.');
  while (!signal.aborted) {
    const op = await db.syncQueue.orderBy('seq').first();
    if (!op) break;
    if (op.kind === 'create') {
      const row = { ...transactionPayload(op.record), user_id: userId };
      const { error } = await client.from('transactions').upsert(row, { onConflict: 'id', ignoreDuplicates: true }).abortSignal(signal);
      if (error) throw error;
      const result = await client.from('transactions').select('id,type,amount,category,date,account,note,card_id,deleted_at').eq('user_id', userId).eq('id', op.recordId).abortSignal(signal).maybeSingle();
      if (result.error) throw result.error;
      if (!result.data || fields.some(key => String(result.data[key]) !== String(row[key]))) throw new Error('A transaction conflicts with a server record. Your local change was kept.');
      if (result.data.deleted_at) throw new Error('This transaction was deleted on another device. Your local change was kept.');
    } else if (op.kind === 'card-create') {
      const row = { id: op.record.id, name: op.record.name, credit_limit: op.record.limit, user_id: userId };
      const { error } = await client.from('cards').upsert(row, { onConflict: 'id', ignoreDuplicates: true }).abortSignal(signal);
      if (error) throw error;
      const result = await client.from('cards').select('id,name,credit_limit,deleted_at').eq('user_id', userId).eq('id', row.id).abortSignal(signal).maybeSingle();
      if (result.error) throw result.error;
      if (!result.data || result.data.deleted_at || result.data.name !== row.name || Number(result.data.credit_limit) !== row.credit_limit) throw new Error('A card conflicts with a server record. Your local card was kept.');
    } else if (op.kind === 'card-update') {
      const record = op.record;
      const changes = { name: record.name, credit_limit: record.limit, deleted_at: record.deletedAt || null };
      const result = await client.from('cards').update(changes).eq('user_id', userId).eq('id', record.id).eq('name', op.previous.name).eq('credit_limit', op.previous.limit).is('deleted_at', null).select('id').abortSignal(signal).maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) {
        const current = await client.from('cards').select('name,credit_limit,deleted_at').eq('user_id', userId).eq('id', record.id).abortSignal(signal).maybeSingle();
        if (current.error) throw current.error;
        if (!current.data || current.data.name !== record.name || Number(current.data.credit_limit) !== record.limit || Boolean(current.data.deleted_at) !== Boolean(record.deletedAt)) throw new Error('A card changed on another device. Your local change was kept.');
      }
    } else if (op.kind === 'reminder-save') {
      const record = op.record;
      const { error } = await client.rpc('save_payment_reminder_v2', { p_id: record.id, p_title: record.title, p_due_date: record.dueDate, p_paid: record.paid, p_card_id: record.cardId || '', p_amount: record.amount || 0, p_send_at: record.sendAt || null, p_version: record.syncVersion, p_previous_version: op.previousVersion || null, p_deleted: Boolean(record.deleted) }).abortSignal(signal);
      if (error) throw error;
    } else if (op.kind === 'document-create') {
      const row = { ...documentPayload(op.record), user_id: userId };
      const { error } = await client.from('documents').upsert(row, { onConflict: 'id', ignoreDuplicates: true }).abortSignal(signal);
      if (error) throw error;
      const result = await client.from('documents').select('id,type,merchant,date,due_date,amount,currency,name').eq('user_id', userId).eq('id', row.id).abortSignal(signal).maybeSingle();
      if (result.error) throw result.error;
      if (!result.data || Object.keys(documentPayload(op.record)).some(key => String(result.data[key]) !== String(row[key]))) throw new Error('A document conflicts with a server record. Your local document was kept.');
    } else if (op.kind === 'delete') {
      const { error } = await client.from('transactions').update({ deleted_at: new Date().toISOString() }).eq('user_id', userId).eq('id', op.recordId).is('deleted_at', null).abortSignal(signal);
      if (error) throw error;
    } else throw new Error('Unknown queued transaction operation.');
    await db.syncQueue.delete(op.seq);
  }
  if (signal.aborted) return;
  let cursor;
  do {
    let query = client.from('transactions').select('id,type,amount,category,date,account,note,card_id,deleted_at').eq('user_id', userId).order('id').limit(500);
    if (cursor) query = query.gt('id', cursor);
    const { data, error } = await query.abortSignal(signal);
    if (error) throw error;
    await db.transaction('rw', db.transactions, db.syncQueue, async () => {
      for (const record of data) {
        if (await db.syncQueue.where('recordId').equals(record.id).count()) continue;
        if (record.deleted_at) await db.transactions.delete(record.id);
        else await db.transactions.put(transactionPayload(record));
      }
    });
    cursor = data.length === 500 ? data[data.length - 1].id : null;
  } while (cursor && !signal.aborted);
  cursor = null;
  do {
    let query = client.from('cards').select('id,name,credit_limit,deleted_at').eq('user_id', userId).order('id').limit(500);
    if (cursor) query = query.gt('id', cursor);
    const { data, error } = await query.abortSignal(signal);
    if (error) throw error;
    await db.transaction('rw', db.cards, db.syncQueue, async () => {
      for (const card of data) {
        if (await db.syncQueue.where('recordId').equals(card.id).count()) continue;
        await db.cards.put({ id: card.id, name: card.name, limit: Number(card.credit_limit), ...(card.deleted_at ? { deletedAt: card.deleted_at } : {}) });
      }
    });
    cursor = data.length === 500 ? data[data.length - 1].id : null;
  } while (cursor && !signal.aborted);
  cursor = null;
  do {
    let query = client.from('documents').select('id,type,merchant,date,due_date,amount,currency,name').eq('user_id', userId).order('id').limit(500);
    if (cursor) query = query.gt('id', cursor);
    const { data, error } = await query.abortSignal(signal);
    if (error) throw error;
    await db.transaction('rw', db.documents, db.syncQueue, async () => {
      for (const document of data) {
        if (await db.syncQueue.where('recordId').equals(document.id).count()) continue;
        const existing = await db.documents.get(document.id);
        await db.documents.put({ ...existing, id: document.id, type: document.type, merchant: document.merchant, date: document.date, dueDate: document.due_date, amount: Number(document.amount), currency: document.currency, name: document.name });
      }
    });
    cursor = data.length === 500 ? data[data.length - 1].id : null;
  } while (cursor && !signal.aborted);
  cursor = null;
  do {
    let query = client.from('payment_reminders').select('id,title,due_date,paid,card_id,amount,send_at,version,deleted_at').eq('user_id', userId).order('id').limit(500);
    if (cursor) query = query.gt('id', cursor);
    const { data, error } = await query.abortSignal(signal);
    if (error) throw error;
    await db.transaction('rw', db.reminders, db.syncQueue, async () => {
      for (const reminder of data) {
        if (await db.syncQueue.where('recordId').equals(reminder.id).count()) continue;
        await db.reminders.put({ id: reminder.id, title: reminder.title, dueDate: reminder.due_date, paid: reminder.paid, cardId: reminder.card_id, amount: Number(reminder.amount), sendAt: reminder.send_at ? new Date(reminder.send_at).toISOString() : '', syncVersion: reminder.version, ...(reminder.deleted_at ? { deleted: true } : {}) });
      }
    });
    cursor = data.length === 500 ? data[data.length - 1].id : null;
  } while (cursor && !signal.aborted);
  if (!signal.aborted) await db.syncMeta.put({ key: 'lastSync', value: new Date().toISOString() });
}

export function syncTransactions(db, userId, signal, client = supabase) {
  if (inFlight.has(db.name)) return inFlight.get(db.name);
  const promise = run(db, userId, signal, client).finally(() => inFlight.delete(db.name));
  inFlight.set(db.name, promise);
  return promise;
}
