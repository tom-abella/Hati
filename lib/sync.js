import { supabase } from './supabase.js';

const fields = ['id', 'type', 'amount', 'category', 'date', 'account', 'note'];
const inFlight = new Map();

export function transactionPayload(record) {
  return Object.fromEntries(fields.map(key => [key, record[key] ?? '']));
}

export async function addTransaction(db, record) {
  await db.transaction('rw', db.transactions, db.syncQueue, async () => {
    await db.transactions.add(record);
    await db.syncQueue.add({ recordId: record.id, kind: 'create', record: transactionPayload(record) });
  });
}

export async function deleteTransaction(db, id) {
  await db.transaction('rw', db.transactions, db.syncQueue, async () => {
    await db.transactions.delete(id);
    await db.syncQueue.add({ recordId: id, kind: 'delete' });
  });
}

async function run(db, userId, signal) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data: { session } } = await supabase.auth.getSession();
  if (!session || session.user.id !== userId) throw new Error('Sign in again to sync.');
  while (!signal.aborted) {
    const op = await db.syncQueue.orderBy('seq').first();
    if (!op) break;
    if (op.kind === 'create') {
      const row = { ...transactionPayload(op.record), user_id: userId };
      const { error } = await supabase.from('transactions').upsert(row, { onConflict: 'id', ignoreDuplicates: true }).abortSignal(signal);
      if (error) throw error;
      const result = await supabase.from('transactions').select('id,type,amount,category,date,account,note,deleted_at').eq('user_id', userId).eq('id', op.recordId).maybeSingle().abortSignal(signal);
      if (result.error) throw result.error;
      if (!result.data || fields.some(key => String(result.data[key]) !== String(row[key]))) throw new Error('A transaction conflicts with a server record. Your local change was kept.');
      if (result.data.deleted_at) throw new Error('This transaction was deleted on another device. Your local change was kept.');
    } else if (op.kind === 'delete') {
      const { error } = await supabase.from('transactions').update({ deleted_at: new Date().toISOString() }).eq('user_id', userId).eq('id', op.recordId).is('deleted_at', null).abortSignal(signal);
      if (error) throw error;
    } else throw new Error('Unknown queued transaction operation.');
    await db.syncQueue.delete(op.seq);
  }
  if (signal.aborted) return;
  let cursor;
  do {
    let query = supabase.from('transactions').select('id,type,amount,category,date,account,note,deleted_at').eq('user_id', userId).order('id').limit(500);
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
  if (!signal.aborted) await db.syncMeta.put({ key: 'lastSync', value: new Date().toISOString() });
}

export function syncTransactions(db, userId, signal) {
  if (inFlight.has(db.name)) return inFlight.get(db.name);
  const promise = run(db, userId, signal).finally(() => inFlight.delete(db.name));
  inFlight.set(db.name, promise);
  return promise;
}
