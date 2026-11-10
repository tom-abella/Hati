'use client';

import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { possibleDuplicate, validateDocument } from '@/lib/documents';
import { transactionPayload } from '@/lib/sync';

export default function ImageEntry({ db, onSignIn }) {
  const [drafts, setDrafts] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [selected, setSelected] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [message, setMessage] = useState('');
  const draft = drafts.find(item => item.id === selected);

  useEffect(() => {
    if (!db) return;
    const draftsSubscription = liveQuery(() => db.imageDrafts.toArray()).subscribe({ next: setDrafts, error: () => setMessage('Could not read image drafts.') });
    const documentsSubscription = liveQuery(() => db.documents.toArray()).subscribe({ next: setDocuments, error: () => setMessage('Could not read confirmed records.') });
    return () => { draftsSubscription.unsubscribe(); documentsSubscription.unsubscribe(); };
  }, [db]);

  useEffect(() => {
    if (!draft) { setImageUrl(''); return; }
    const url = URL.createObjectURL(draft.image);
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [draft]);

  async function upload(event) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) {
      setMessage('Choose a JPEG, PNG or WebP image no larger than 10 MB.'); return;
    }
    try {
      const id = crypto.randomUUID();
      await db.imageDrafts.add({ id, image: file, name: file.name, createdAt: Date.now() });
      setSelected(id); setMessage('Image saved as a local draft. Enter and review the details below.');
    } catch { setMessage('Could not save the image. Check available device storage.'); }
  }

  async function save(event) {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const item = validateDocument(Object.fromEntries(new FormData(form)));
      const records = item.type === 'expense' ? await db.transactions.toArray() : await db.documents.toArray();
      if (possibleDuplicate(item, records) && !window.confirm('A record with the same type, date and amount exists. Save this possible duplicate?')) return;
      await db.transaction('rw', db.imageDrafts, db.documents, db.transactions, db.syncQueue, async () => {
        const source = await db.imageDrafts.get(draft.id);
        if (!source) throw new Error('This draft no longer exists.');
        await db.documents.add({ ...item, id: draft.id, image: source.image, name: source.name });
        if (item.type === 'expense') {
          const record = { id: draft.id, type: 'expense', amount: item.amount, date: item.date, category: 'Uncategorized', account: '', note: item.merchant };
          await db.transactions.add(record);
          await db.syncQueue.add({ recordId: record.id, kind: 'create', record: transactionPayload(record) });
        }
        await db.imageDrafts.delete(draft.id);
      });
      setSelected(''); setMessage('Saved on this device. Expenses are queued for sync; images, bills and statements are local only.');
    } catch (error) { setMessage(error.issues?.[0]?.message || error.message || 'Could not save the record.'); }
  }

  async function discard() {
    if (!window.confirm('Delete this local image draft?')) return;
    try { await db.imageDrafts.delete(draft.id); setSelected(''); setMessage('Draft deleted.'); }
    catch { setMessage('Could not delete this draft.'); }
  }

  return <section className="image-entry"><h2>Receipt or bill</h2>
    <p>Upload a photo or use your camera. Images and confirmed records are stored only on this device. Do not upload images showing full card numbers, CVVs or credentials. Automatic extraction is not available yet; enter and verify each field yourself.</p>
    {!db ? <button className="secondary image-action" onClick={onSignIn}>Sign in to save an image</button> : <>
      <label className="image-picker">Choose an image or take a photo<input type="file" accept="image/jpeg,image/png,image/webp" onChange={upload} /></label>
      {drafts.length > 0 && <label>Saved drafts<select value={selected} onChange={event => { setSelected(event.target.value); setMessage(''); }}><option value="">Choose a draft</option>{drafts.map(item => <option value={item.id} key={item.id}>{item.name || 'Image'} · {new Date(item.createdAt).toLocaleString()}</option>)}</select></label>}
      {draft && <div key={draft.id}><img className="receipt-preview" src={imageUrl} alt="Selected receipt or bill" /><p>Review required: all fields are unverified. Bill and statement records are references only; they do not create a payable or reminder.</p>
        <form onSubmit={save}>
          <label>Record type<select name="type" defaultValue="expense"><option value="expense">Expense</option><option value="bill">Bill</option><option value="statement">Credit Card Statement</option></select></label>
          <label>Merchant or provider — required<input name="merchant" maxLength="80" required /></label>
          <div className="row"><label>Transaction date — required<input type="date" name="date" required /></label><label>Due date — required for bills and statements<input type="date" name="dueDate" /></label></div>
          <div className="row"><label>Total — required<input name="amount" inputMode="decimal" required placeholder="0.00" /></label><label>Currency — required<select name="currency" defaultValue=""><option value="" disabled>Choose currency</option><option value="PHP">PHP</option></select></label></div>
          <button type="submit">Confirm and save</button><button type="button" className="secondary" onClick={discard}>Delete draft</button>
        </form>
      </div>}
      {documents.length > 0 && <><h2>Confirmed records</h2><ul>{documents.map(item => <li key={item.id}><div><strong>{item.merchant}</strong><small>{item.type} · {item.date}{item.dueDate ? ` · due ${item.dueDate}` : ''} · PHP {(item.amount / 100).toFixed(2)}</small></div></li>)}</ul></>}
    </>}{message && <p role="status" className="image-message">{message}</p>}
  </section>;
}
