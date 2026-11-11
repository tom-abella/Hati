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
  db.version(6).stores({}).upgrade(async tx => {
    const cards = await tx.table('cards').toArray();
    await tx.table('syncQueue').bulkAdd(cards.map(record => ({ recordId: record.id, kind: 'card-create', record })));
  });
  db.version(7).stores({}).upgrade(async tx => {
    const documents = await tx.table('documents').toArray();
    await tx.table('syncQueue').bulkAdd(documents.map(({ image, ...record }) => ({ recordId: record.id, kind: 'document-create', record })));
  });
  db.version(8).stores({}).upgrade(async tx => {
    const reminders = await tx.table('reminders').toArray();
    for (const reminder of reminders) {
      const record = { ...reminder, syncVersion: crypto.randomUUID() };
      await tx.table('reminders').put(record);
      await tx.table('syncQueue').add({ recordId: record.id, kind: 'reminder-save', record, previousVersion: null });
    }
  });
  return db;
}

export const previewDb = new Dexie('hati-local-preview');
previewDb.version(1).stores({ transactions: 'id,date,type,category' });
