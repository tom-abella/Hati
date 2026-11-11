'use client';

import { useEffect, useRef, useState } from 'react';
import { liveQuery } from 'dexie';
import { possibleDuplicate, validateDocument } from '@/lib/documents';
import { documentPayload, transactionPayload } from '@/lib/sync';
import { receiptSuggestions } from '@/lib/receipt-text';
import ApplePayEntry from './apple-pay-entry';

export default function ImageEntry({ db, cards, onSignIn }) {
  const [mode, setMode] = useState('single');
  return <><div className="entry-mode" role="group" aria-label="Image transaction type"><button type="button" className="secondary" aria-pressed={mode === 'single'} onClick={() => setMode('single')}>Single transaction</button><button type="button" className="secondary" aria-pressed={mode === 'history'} onClick={() => setMode('history')}>Apple Pay history</button></div>{mode === 'single' ? <SingleImageEntry db={db} cards={cards} onSignIn={onSignIn} /> : <ApplePayEntry db={db} cards={cards} onSignIn={onSignIn} />}</>;
}

function SingleImageEntry({ db, cards, onSignIn }) {
  const [drafts, setDrafts] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [selected, setSelected] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [message, setMessage] = useState('');
  const [temporaryDraft, setTemporaryDraft] = useState(null);
  const [suggestions, setSuggestions] = useState({});
  const [busy, setBusy] = useState(false);
  const ocrController = useRef(null);
  const draft = temporaryDraft || drafts.find(item => item.id === selected);

  useEffect(() => {
    if (!db) return;
    const controller = new AbortController();
    ocrController.current = controller;
    const draftsSubscription = liveQuery(() => db.imageDrafts.toArray()).subscribe({ next: setDrafts, error: () => setMessage('Could not read image drafts.') });
    const documentsSubscription = liveQuery(() => db.documents.toArray()).subscribe({ next: setDocuments, error: () => setMessage('Could not read confirmed records.') });
    return () => { controller.abort(); draftsSubscription.unsubscribe(); documentsSubscription.unsubscribe(); };
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
    const id = crypto.randomUUID();
    const signal = ocrController.current.signal;
    setSelected(''); setTemporaryDraft({ id, image: file, name: file.name }); setSuggestions({}); setBusy(true);
    setMessage('Reading image on this device…');
    let worker;
    try {
      const { createWorker } = await import('tesseract.js');
      worker = await createWorker('eng');
      if (signal.aborted) return;
      const result = await worker.recognize(file);
      if (!signal.aborted) { setSuggestions(receiptSuggestions(result.data.text)); setMessage('Review every suggested field against the image before saving.'); }
    } catch { if (!signal.aborted) setMessage('Could not read the image. You can enter the details manually.'); }
    finally { if (worker) await worker.terminate(); if (!signal.aborted) setBusy(false); }
  }

  async function save(event) {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const data = new FormData(form);
      const item = validateDocument(Object.fromEntries(data));
      const cardId = String(data.get('card_id') || '');
      if (cardId && (item.type !== 'expense' || !cards.some(card => card.id === cardId && !card.deletedAt))) throw new Error('Select a credit card only for an expense.');
      const records = item.type === 'expense' ? await db.transactions.toArray() : await db.documents.toArray();
      if (possibleDuplicate(item, records) && !window.confirm('A record with the same type, date and amount exists. Save this possible duplicate?')) return;
      await db.transaction('rw', db.imageDrafts, db.documents, db.transactions, db.syncQueue, async () => {
        if (!temporaryDraft && !await db.imageDrafts.get(draft.id)) throw new Error('This draft no longer exists.');
        const document = { ...item, id: draft.id, name: draft.name };
        await db.documents.add(document);
        await db.syncQueue.add({ recordId: document.id, kind: 'document-create', record: documentPayload(document) });
        if (item.type === 'expense') {
          const record = { id: draft.id, type: 'expense', amount: item.amount, date: item.date, category: 'Uncategorized', account: '', note: item.merchant, card_id: cardId };
          await db.transactions.add(record);
          await db.syncQueue.add({ recordId: record.id, kind: 'create', record: transactionPayload(record) });
        }
        await db.imageDrafts.delete(draft.id);
      });
      setSelected(''); setTemporaryDraft(null); setSuggestions({}); setMessage('Details saved and queued for sync. The image was not saved.');
    } catch (error) { setMessage(error.issues?.[0]?.message || error.message || 'Could not save the record.'); }
  }

  async function discard() {
    if (!window.confirm('Delete this local image draft?')) return;
    try { if (!temporaryDraft) await db.imageDrafts.delete(draft.id); setTemporaryDraft(null); setSelected(''); setSuggestions({}); setMessage('Draft deleted.'); }
    catch { setMessage('Could not delete this draft.'); }
  }

  return <section className="image-entry"><h2>Receipt or bill</h2>
    <p>Choose a photo to read it on this device. New images are not saved. Review all suggested details before saving.</p>
    {!db ? <button className="secondary image-action" onClick={onSignIn}>Sign in to save an image</button> : <>
      <label className="image-picker">Choose an image or take a photo<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={upload} /></label>
      {drafts.length > 0 && <label>Previously saved drafts<select value={selected} disabled={busy} onChange={event => { setTemporaryDraft(null); setSuggestions({}); setSelected(event.target.value); setMessage(''); }}><option value="">Choose a draft</option>{drafts.map(item => <option value={item.id} key={item.id}>{item.name || 'Image'} · {new Date(item.createdAt).toLocaleString()}</option>)}</select></label>}
      {draft && <div key={draft.id}>{imageUrl && <img className="receipt-preview" src={imageUrl} alt="Selected receipt or bill" />}<p>Review required: all fields are unverified. Bill and statement records are references only; they do not create a payable or reminder.</p>
        {!busy && <form key={`${draft.id}-${suggestions.merchant || ''}-${suggestions.amount || ''}`} onSubmit={save}>
          <label>Record type<select name="type" defaultValue="expense"><option value="expense">Expense</option><option value="bill">Bill</option><option value="statement">Credit Card Statement</option></select></label>
          <label>Credit card for expense <span className="optional">(optional)</span><select name="card_id"><option value="">No credit card</option>{cards.filter(card => !card.deletedAt).map(card => <option key={card.id} value={card.id}>{card.name}</option>)}</select></label>
          <label>Merchant or provider — required<input name="merchant" maxLength="80" defaultValue={suggestions.merchant || ''} required /></label>
          <div className="row"><label>Transaction date — required<input type="date" name="date" defaultValue={suggestions.date || ''} required /></label><label>Due date — required for bills and statements<input type="date" name="dueDate" /></label></div>
          <div className="row"><label>Total — required<input name="amount" inputMode="decimal" defaultValue={suggestions.amount || ''} required placeholder="0.00" /></label><label>Currency — required<select name="currency" defaultValue=""><option value="" disabled>Choose currency</option><option value="PHP">PHP</option></select></label></div>
          <button type="submit">Confirm and save</button><button type="button" className="secondary" onClick={discard}>Delete draft</button>
        </form>}
      </div>}
      {documents.length > 0 && <><h2>Confirmed records</h2><ul>{documents.map(item => <li key={item.id}><div><strong>{item.merchant}</strong><small>{item.type} · {item.date}{item.dueDate ? ` · due ${item.dueDate}` : ''} · PHP {(item.amount / 100).toFixed(2)}</small></div></li>)}</ul></>}
    </>}{message && <p role="status" className="image-message">{message}</p>}
  </section>;
}
