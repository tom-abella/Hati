'use client';

import { useEffect, useRef, useState } from 'react';
import { liveQuery } from 'dexie';
import { applePaySuggestions, applyPhilippinesCurrency, duplicateCount, resolveHistoryDate } from '@/lib/apple-pay';
import { possibleDuplicate, validateDocument } from '@/lib/documents';
import { toCentavos } from '@/lib/money';
import { addTransactions } from '@/lib/sync';

const blankRow = () => ({ id: crypto.randomUUID(), selected: false, merchant: '', amount: '', date: '', currency: '', category: 'Uncategorized', source: '' });
const manilaNow = () => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
};

export default function ApplePayEntry({ db, cards, onSignIn }) {
  const [imageUrl, setImageUrl] = useState('');
  const [text, setText] = useState('');
  const [rows, setRows] = useState([]);
  const [entries, setEntries] = useState([]);
  const [cardId, setCardId] = useState('');
  const [capturedAt, setCapturedAt] = useState('');
  const [dateOrder, setDateOrder] = useState('');
  const [takenInPhilippines, setTakenInPhilippines] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const controller = useRef(null);

  useEffect(() => {
    if (!db) return;
    const abort = new AbortController();
    controller.current = abort;
    const subscription = liveQuery(() => db.transactions.toArray()).subscribe({ next: setEntries, error: () => setMessage('Could not read existing transactions.') });
    return () => { abort.abort(); subscription.unsubscribe(); };
  }, [db]);

  useEffect(() => () => { if (imageUrl) URL.revokeObjectURL(imageUrl); }, [imageUrl]);

  async function upload(event) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) { setMessage('Choose a JPEG, PNG or WebP image no larger than 10 MB.'); return; }
    const signal = controller.current.signal;
    const reference = manilaNow();
    setCapturedAt(reference);
    setTakenInPhilippines(false);
    setImageUrl(URL.createObjectURL(file)); setRows([]); setText(''); setBusy(true); setMessage('Reading the screenshot on this device…');
    let worker;
    try {
      const { createWorker } = await import('tesseract.js');
      worker = await createWorker('eng');
      if (signal.aborted) return;
      const result = await worker.recognize(file);
      if (!signal.aborted) {
        const suggestions = applePaySuggestions(result.data.text, { capturedAt: reference, dateOrder });
        setText(result.data.text);
        setRows(suggestions.map(suggestion => ({ ...blankRow(), ...suggestion })));
        setMessage(suggestions.length ? 'Review each suggestion against the screenshot. Select only completed PHP expenses to import.' : 'No amounts were detected. Check the extracted text or add entries manually.');
      }
    } catch { if (!signal.aborted) setMessage('Could not read the screenshot. You can add entries manually.'); }
    finally { if (worker) await worker.terminate(); if (!signal.aborted) setBusy(false); }
  }

  function change(id, key, value) {
    setRows(items => items.map(row => row.id === id ? { ...row, [key]: value, ...(key === 'date' ? { dateEdited: true } : {}), ...(key === 'currency' ? { currencyEdited: true, currencyAssumed: false } : {}) } : row));
  }

  function updateDates() {
    if (!resolveHistoryDate('today', capturedAt)) { setMessage('Enter the screenshot capture date and time in Asia/Manila.'); return; }
    const unresolved = rows.filter(row => row.dateLabel && !row.dateEdited && !resolveHistoryDate(row.dateLabel, capturedAt, dateOrder)).length;
    setRows(items => items.map(row => row.dateLabel && !row.dateEdited ? { ...row, date: resolveHistoryDate(row.dateLabel, capturedAt, dateOrder) } : row));
    setMessage(unresolved ? `${unresolved} detected date${unresolved === 1 ? '' : 's'} could not be resolved; check the date order or enter them manually. Dates you edited were kept.` : 'Date suggestions updated. Check them against the screenshot; dates you edited were kept.');
  }

  function duplicate(row) {
    try {
      const amount = toCentavos(row.amount);
      return Boolean(row.date && possibleDuplicate({ type: 'expense', date: row.date, amount }, entries));
    } catch { return false; }
  }

  async function save(event) {
    event.preventDefault();
    const selected = rows.filter(row => row.selected);
    if (!selected.length) { setMessage('Select at least one transaction to import.'); return; }
    const signal = controller.current.signal;
    try {
      if (cardId && !cards.some(card => card.id === cardId && !card.deletedAt)) throw new Error('Select an available credit card.');
      const records = selected.map((row, index) => {
        try {
          const item = validateDocument({ type: 'expense', merchant: row.merchant, date: row.date, dueDate: '', amount: row.amount, currency: row.currency });
          const category = row.category.trim();
          if (!category || category.length > 80) throw new Error('Enter a category of up to 80 characters.');
          return { id: crypto.randomUUID(), type: 'expense', amount: item.amount, category, date: item.date, account: 'Apple Pay', note: item.merchant, card_id: cardId };
        } catch (error) { throw new Error(`Selected entry ${index + 1}: ${error.issues?.[0]?.message || error.message}`); }
      });
      setBusy(true);
      const existing = await db.transactions.toArray();
      if (signal.aborted) return;
      const duplicates = duplicateCount(records, existing);
      if (duplicates && !window.confirm(`${duplicates} selected transaction${duplicates === 1 ? ' has' : 's have'} the same date and amount as another entry. Import anyway?`)) return;
      await addTransactions(db, records);
      if (!signal.aborted) { setImageUrl(''); setText(''); setRows([]); setCardId(''); setMessage(`Imported ${records.length} transaction${records.length === 1 ? '' : 's'} and queued for sync. The screenshot was not saved.`); }
    } catch (error) { if (!signal.aborted) setMessage(error.message || 'Could not import the transactions.'); }
    finally { if (!signal.aborted) setBusy(false); }
  }

  return <section className="image-entry"><h2>Apple Pay history</h2><p>Read a screenshot on this device. Images are not saved. Dates, currency and every transaction must be reviewed; pending, refunded or duplicate entries should not be imported as purchases.</p>
    {!db ? <button type="button" className="secondary image-action" onClick={onSignIn}>Sign in to import</button> : <>
      <label className="image-picker">Choose a history screenshot<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={upload} /></label>
      {imageUrl && <>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="receipt-preview" src={imageUrl} alt="Selected Apple Pay history screenshot" />{text && <details><summary>Show extracted text</summary><pre className="history-text">{text}</pre></details>}
        {!busy && <form onSubmit={save}><label>Screenshot taken at (Asia/Manila)<input type="datetime-local" value={capturedAt} onChange={event => setCapturedAt(event.target.value)} /></label><p>Defaults to when you uploaded the screenshot. Change it if the screenshot was taken earlier; relative dates depend on it. A weekday matching the capture day is left blank for review.</p><label>For dates like 11/4/26<select value={dateOrder} onChange={event => setDateOrder(event.target.value)}><option value="">Choose date order if ambiguous</option><option value="MDY">Month/day/year</option><option value="DMY">Day/month/year</option></select></label><button type="button" className="secondary" onClick={updateDates}>Update suggested dates</button><p>This updates detected dates you haven’t edited. Check every date against the screenshot.</p><label className="history-select"><input type="checkbox" checked={takenInPhilippines} onChange={event => { const checked = event.target.checked; setTakenInPhilippines(checked); setRows(items => applyPhilippinesCurrency(items, checked)); }} /> Screenshot taken in the Philippines: suggest PHP when no currency is visible</label><p>Location doesn’t guarantee the transaction currency. Check each amount; detected foreign currencies are not automatically changed.</p><label>Credit card for selected expenses <span className="optional">(optional)</span><select value={cardId} onChange={event => setCardId(event.target.value)}><option value="">No credit card</option>{cards.filter(card => !card.deletedAt).map(card => <option key={card.id} value={card.id}>{card.name}</option>)}</select></label>
          {rows.map((row, index) => <fieldset className="history-row" key={row.id}><legend>Entry {index + 1}</legend><label className="history-select"><input type="checkbox" checked={row.selected} onChange={event => change(row.id, 'selected', event.target.checked)} /> Import this entry</label>{row.source && <p>Detected: {row.source}</p>}{row.dateLabel && <p>Detected date: {row.dateLabel} — verify the suggested date.</p>}{row.currencyAssumed && <p>PHP suggested from the screenshot location; verify the currency.</p>}{row.foreignCurrency && <p className="error">A foreign currency was detected. Confirm the amount and currency before importing.</p>}{duplicate(row) && <p className="error">Possible duplicate: an existing expense has the same date and amount.</p>}
            <div className="row"><label>Merchant<input value={row.merchant} maxLength="80" onChange={event => change(row.id, 'merchant', event.target.value)} /></label><label>Amount<input value={row.amount} inputMode="decimal" onChange={event => change(row.id, 'amount', event.target.value)} placeholder="0.00" /></label></div>
            <div className="row"><label>Date<input type="date" value={row.date} onChange={event => change(row.id, 'date', event.target.value)} /></label><label>Currency<select value={row.currency} onChange={event => change(row.id, 'currency', event.target.value)}><option value="">Confirm currency</option><option value="PHP">PHP</option></select></label></div>
            <label>Category<input value={row.category} maxLength="80" onChange={event => change(row.id, 'category', event.target.value)} /></label>
          </fieldset>)}
          <div className="auth-actions"><button type="button" className="secondary" onClick={() => setRows(items => [...items, ...applyPhilippinesCurrency([blankRow()], takenInPhilippines)])}>Add missing entry</button><button type="submit">Import selected</button></div>
        </form>}
      </>}
    </>}{message && <p role="status" className="image-message">{message}</p>}
  </section>;
}
