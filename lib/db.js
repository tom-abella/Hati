import Dexie from 'dexie';

export function accountDb(userId) {
  const db = new Dexie(`hati-account-${userId}`);
  db.version(1).stores({ transactions: 'id,date,type,category' });
  db.version(2).stores({ reminders: 'id,dueDate,paid' });
  db.version(3).stores({ imageDrafts: 'id,createdAt', documents: 'id,type,date,dueDate' });
  db.version(4).stores({ syncQueue: '++seq,recordId', syncMeta: 'key' }).upgrade(async tx => {
    const entries = await tx.table('transactions').toArray();
    await tx.table('syncQueue').bulkAdd(entries.map(record => ({ recordId: record.id, kind: 'create', record })));
  });
  db.version(5).stores({ cards: 'id' });
  return db;
}

export const previewDb = new Dexie('hati-local-preview');
previewDb.version(1).stores({ transactions: 'id,date,type,category' });
