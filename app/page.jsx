'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { liveQuery } from 'dexie';
import { accountDb } from '@/lib/db';
import { money, toCentavos } from '@/lib/money';
import { paymentStatus, reminderSendAt } from '@/lib/reminders';
import { availableCredit } from '@/lib/cards';
import { loadSupplementary, statementPurchases, supplementarySpent } from '@/lib/supplementary';
import { supabase } from '@/lib/supabase';
import ImageEntry from './image-entry';
import EnableNotificationsButton from './enable-notifications-button';
import { addCard, addReminder, addSupplementaryTransaction, addTransaction, deleteTransaction, setReminderPaid, syncTransactions, updateCard, updateReminder } from '@/lib/sync';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

function SignIn({ onBack }) {
  const [message, setMessage] = useState('');
  const [signupMessage, setSignupMessage] = useState('');
  const [verificationEmail, setVerificationEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const signupDialog = useRef(null);

  async function authenticate(event, signup = false) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const credentials = { email: String(data.get('email')).trim(), password: String(data.get('password')) };
    setBusy(true);
    setMessage('');
    setSignupMessage('');
    try {
      const result = signup
        ? await supabase.auth.signUp(credentials)
        : await supabase.auth.signInWithPassword(credentials);
      if (result.error?.code === 'email_not_confirmed' && !signup) {
        setVerificationEmail(credentials.email);
        signupDialog.current?.showModal();
      } else if (result.error) (signup ? setSignupMessage : setMessage)(result.error.message);
      else if (signup && !result.data.session) {
        setVerificationEmail(credentials.email);
      }
    } catch { (signup ? setSignupMessage : setMessage)('Could not connect. Check your connection and try again.'); }
    finally { setBusy(false); }
  }

  async function resendConfirmation() {
    setBusy(true);
    setSignupMessage('');
    try {
      const { error } = await supabase.auth.resend({ type: 'signup', email: verificationEmail });
      setSignupMessage(error ? error.message : 'If this address can be confirmed, another email has been requested. Check your inbox and spam folder.');
    } catch { setSignupMessage('Could not connect. Check your connection and try again.'); }
    finally { setBusy(false); }
  }

  if (!supabase) return <main><aside className="notice">Supabase is not configured. Add the project URL and publishable key to .env.local and restart the app.</aside><button onClick={onBack}>Back to preview</button></main>;
  return <main className="auth-screen"><section className="panel auth"><span className="eyebrow">HATI / PERSONAL BUDGET</span><h1>Welcome to Hati.</h1><p>Sign in to access your local budget. Initial sign-in requires internet.</p><form onSubmit={event => authenticate(event)}>
    <label>Email<input type="email" name="email" autoComplete="email" required /></label>
    <label>Password<input type="password" name="password" autoComplete="current-password" required /></label>
    {message && <p role="status">{message}</p>}
    <div className="auth-actions"><button disabled={busy} type="submit">Sign in</button><button disabled={busy} type="button" className="secondary" onClick={() => { setSignupMessage(''); setVerificationEmail(''); signupDialog.current.showModal(); }}>Create account</button></div>
  </form><button type="button" className="secondary browse-button" onClick={onBack}>Continue browsing</button><p className="auth-note">Existing preview entries remain on this device and are not imported automatically. Local data is not backed up or encrypted.</p></section>
    <dialog ref={signupDialog} className="signup-dialog" aria-labelledby="signup-title">
      {verificationEmail ? <><h2 id="signup-title">Check your email</h2><p>If an account can be confirmed for <strong>{verificationEmail}</strong>, follow the link in the confirmation email. Check your spam folder too, then return here to sign in.</p>
        {signupMessage && <p role="status">{signupMessage}</p>}
        <div className="auth-actions verification-actions"><button type="button" disabled={busy} onClick={resendConfirmation}>Resend confirmation</button><button type="button" autoFocus className="secondary" onClick={() => signupDialog.current.close()}>Back to sign in</button></div>
      </> : <><h2 id="signup-title">Create an account</h2><p>Use your email and a password to get started.</p>
      <form onSubmit={event => authenticate(event, true)}>
        <label>Email<input type="email" name="email" autoComplete="email" required /></label>
        <label>Password<input type="password" name="password" autoComplete="new-password" minLength="6" required /></label>
        {signupMessage && <p role="alert">{signupMessage}</p>}
        <div className="auth-actions"><button type="submit" disabled={busy}>Create account</button><button type="button" className="secondary" disabled={busy} onClick={() => signupDialog.current.close()}>Cancel</button></div>
      </form></>}
    </dialog></main>;
}

export default function Home() {
  const [session, setSession] = useState(null);
  const [showAuth, setShowAuth] = useState(false);
  useEffect(() => {
    if (!supabase) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (nextSession) setShowAuth(false);
    });
    return () => subscription.unsubscribe();
  }, []);
  return showAuth && !session ? <SignIn onBack={() => setShowAuth(false)} /> : <Budget key={session?.user.id || 'guest'} user={session?.user} onSignIn={() => setShowAuth(true)} />;
}

function Budget({ user, onSignIn }) {
  const db = useMemo(() => user?.id ? accountDb(user.id) : null, [user?.id]);
  const [entries, setEntries] = useState([]);
  const [cards, setCards] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [entryType, setEntryType] = useState('expense');
  const [online, setOnline] = useState(true);
  const [error, setError] = useState('');
  const [month, setMonth] = useState('');
  const [section, setSection] = useState('Overview');
  const [entryMode, setEntryMode] = useState('manual');
  const [dueCount, setDueCount] = useState(0);
  const [pending, setPending] = useState(0);
  const [pendingShared, setPendingShared] = useState([]);
  const [lastSync, setLastSync] = useState('');
  const [syncMessage, setSyncMessage] = useState('');
  const [shared, setShared] = useState(null);
  const syncNow = useRef(null);

  useEffect(() => {
    setMonth(today().slice(0, 7));
    if (new URLSearchParams(window.location.search).get('section') === 'reminders') setSection('Reminders');
    const updateOnline = () => setOnline(navigator.onLine);
    updateOnline();
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    const subscription = db && liveQuery(() => db.transactions.orderBy('date').reverse().toArray()).subscribe({ next: setEntries, error: () => setError('Could not read local storage.') });
    const cardSubscription = db && liveQuery(async () => ({ cards: await db.cards.toArray(), reminders: await db.reminders.toArray() })).subscribe({ next: data => { setCards(data.cards); setReminders(data.reminders); }, error: () => setError('Could not read cards.') });
    const sharedSubscription = db && liveQuery(() => db.sharedCache.get('records')).subscribe({ next: value => setShared(value?.data || null), error: () => setError('Could not read shared cards.') });
    return () => { window.removeEventListener('online', updateOnline); window.removeEventListener('offline', updateOnline); subscription?.unsubscribe(); cardSubscription?.unsubscribe(); sharedSubscription?.unsubscribe(); };
  }, [db]);

  useEffect(() => {
    if (!db || !user) return;
    const controller = new AbortController();
    let syncing = false;
    let requested = false;
    const sync = async () => {
      if (!navigator.onLine || controller.signal.aborted) return;
      if (syncing) { requested = true; return; }
      syncing = true;
      do {
        requested = false;
        setSyncMessage('Syncing your records…');
        let failure;
        try { await syncTransactions(db, user.id, controller.signal); } catch (error) { failure = error; }
        if (!controller.signal.aborted) {
          try {
            const sharedData = await loadSupplementary(supabase, controller.signal);
            if (!controller.signal.aborted) await db.sharedCache.put({ key: 'records', data: sharedData });
            if (!failure && !controller.signal.aborted) await db.syncMeta.put({ key: 'lastSync', value: new Date().toISOString() });
          } catch (error) { failure ||= error; }
        }
        if (!controller.signal.aborted) {
          setSyncMessage(failure ? `Sync failed: ${failure.message || 'try again when online.'}` : '');
          try { if (!failure && await db.syncQueue.count()) requested = true; }
          catch { setSyncMessage('Could not read sync status.'); }
        }
      } while (requested && !controller.signal.aborted && navigator.onLine);
      syncing = false;
    };
    syncNow.current = sync;
    const subscription = liveQuery(async () => ({ operations: await db.syncQueue.toArray(), last: await db.syncMeta.get('lastSync') })).subscribe({ next: ({ operations, last }) => { setPending(operations.length); setPendingShared(operations.filter(op => op.kind === 'supplementary-create').map(op => op.record)); setLastSync(last?.value || ''); if (operations.length) sync(); }, error: () => setSyncMessage('Could not read sync status.') });
    window.addEventListener('online', sync);
    window.addEventListener('focus', sync);
    sync();
    return () => { syncNow.current = null; controller.abort(); subscription.unsubscribe(); window.removeEventListener('online', sync); window.removeEventListener('focus', sync); };
  }, [db, user?.id]);

  async function addEntry(event) {
    event.preventDefault();
    if (!user) { onSignIn(); return; }
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const amount = toCentavos(String(data.get('amount')));
      const category = String(data.get('category')).trim();
      if (!category) throw new Error('Enter a category.');
      const cardId = String(data.get('card_id') || '');
      const supplementary = shared?.cards.find(card => card.id === cardId && card.accepted_at && !card.revoked_at);
      if (cardId && (data.get('type') !== 'expense' || (!supplementary && !cards.some(card => card.id === cardId && !card.deletedAt)))) throw new Error('Select a valid credit card for an expense.');
      const record = { id: crypto.randomUUID(), type: data.get('type'), amount, category, date: data.get('date'), account: String(data.get('account')).trim(), note: String(data.get('note')).trim(), card_id: cardId };
      if (supplementary) {
        await addSupplementaryTransaction(db, record);
      } else await addTransaction(db, record);
      form.reset();
      setEntryType('expense');
      setError('');
    } catch (err) { setError(err.issues?.[0]?.message || err.message || 'Could not save this entry on this device.'); }
  }

  async function remove(id, supplementary = false) {
    if (!window.confirm('Delete this entry?')) return;
    try {
      if (supplementary) { const { error } = await supabase.rpc('delete_supplementary_transaction', { p_id: id }); if (error) throw error; syncNow.current?.(); }
      else {
        const entry = entries.find(item => item.id === id);
        if (entry?.card_id) {
          if (!navigator.onLine || await db.syncQueue.count()) throw new Error('Connect and sync pending changes before deleting a card transaction.');
          const result = await supabase.from('transactions').update({ deleted_at: new Date().toISOString() }).eq('id', id).eq('user_id', user.id).is('deleted_at', null).select('id').maybeSingle();
          if (result.error) throw result.error;
          if (!result.data) {
            const existing = await supabase.from('transactions').select('deleted_at').eq('id', id).eq('user_id', user.id).maybeSingle();
            if (existing.error || !existing.data?.deleted_at) throw new Error('This transaction could not be verified.');
          }
        }
        await deleteTransaction(db, id);
      }
    } catch (err) { setError(err.message || 'Could not delete this entry.'); }
  }

  const remoteSharedIds = new Set((shared?.transactions || []).map(entry => entry.id));
  const unsyncedShared = pendingShared.filter(entry => !remoteSharedIds.has(entry.id));
  const pendingSharedEntries = unsyncedShared.map(entry => ({ ...entry, account: `${entry.account ? `${entry.account} · ` : ''}Supplementary card · pending sync`, supplementary: true, pendingSync: true }));
  const displayShared = shared && { ...shared, transactions: [...shared.transactions, ...unsyncedShared.map(entry => ({ ...entry, supplementary_card_id: entry.card_id, created_by: user.id, pendingSync: true }))] };
  const sharedOwnEntries = [...(shared?.transactions || []).filter(entry => !entry.deleted_at && entry.created_by === user?.id).map(entry => ({ id: entry.id, type: 'expense', amount: Number(entry.amount), category: entry.category, date: entry.date, account: `${entry.account ? `${entry.account} · ` : ''}Supplementary card`, note: entry.note, card_id: entry.supplementary_card_id, supplementary: true })), ...pendingSharedEntries];
  const current = [...entries, ...sharedOwnEntries].filter(entry => entry.date.startsWith(month)).sort((a, b) => b.date.localeCompare(a.date));
  const income = current.filter(entry => entry.type === 'income').reduce((sum, entry) => sum + entry.amount, 0);
  const expenses = current.filter(entry => entry.type === 'expense').reduce((sum, entry) => sum + entry.amount, 0);

  function exportCsv() {
    const rows = [['Date', 'Type', 'Category', 'Amount (PHP)', 'Account', 'Note'], ...current.map(e => [e.date, e.type, e.category, (e.amount / 100).toFixed(2), e.account, e.note])];
    const csv = rows.map(row => row.map(value => `"${String(value ?? '').replace(/^[\s]*[=+\-@\t\r]/, "'$&").replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `hati-${month}.csv`; link.click(); URL.revokeObjectURL(url);
  }

  return <main>
    <header><div><span className="eyebrow">HATI / PERSONAL BUDGET</span><h1>A little more clarity.</h1><p>Your money, in one thoughtful place.</p></div><div className="account"><span className="status"><span className={online ? 'dot' : 'dot offline'} />{online ? 'Online' : 'Offline'}</span>{user ? <><span>{user.email}</span><button className="secondary" onClick={async () => { const { error } = await supabase.auth.signOut({ scope: 'local' }); if (error) setError(error.message); }}>Sign out</button></> : <button className="secondary" onClick={onSignIn}>Sign in</button>}</div></header>
    <nav className="navigation" aria-label="Budget sections">{['Overview', 'Transactions', 'Cards', 'Reminders', 'Coming up'].map(item => <button type="button" key={item} aria-current={section === item ? 'page' : undefined} onClick={() => setSection(item)}>{item}</button>)}</nav>
    <aside className="notice notice-with-action"><div><strong>Early preview.</strong> {user ? `Records: ${pending} pending change${pending === 1 ? '' : 's'}. Last successful sync: ${lastSync ? new Date(lastSync).toLocaleString() : 'never'}.` : 'Browse as a guest; sign in to save or view personal entries.'} {syncMessage} Scheduled notifications require setup and connectivity; offline changes take effect on the server after sync.</div>{user && <button type="button" className="secondary" disabled={!online} onClick={() => syncNow.current?.()}>Sync now</button>}</aside>
    {dueCount > 0 && section !== 'Reminders' && <aside className="notice notice-with-action" role="status"><strong>{dueCount} payment{dueCount === 1 ? '' : 's'} due or overdue.</strong><button className="secondary" onClick={() => setSection('Reminders')}>View reminders</button></aside>}
    <div hidden={section !== 'Overview'}>
    <section className="heading"><div><span className="eyebrow">YOUR OVERVIEW</span><h2>Monthly snapshot</h2></div><label>Month <input aria-label="Report month" type="month" value={month} onChange={e => setMonth(e.target.value)} /></label></section>
    <section className="stats"><article className="stat dark"><span>Left after expenses</span><strong>{money(income - expenses)}</strong><small>Income less spending</small></article><article className="stat"><span>Income</span><strong>{money(income)}</strong><small>This month</small></article><article className="stat"><span>Expenses</span><strong>{money(expenses)}</strong><small>This month</small></article></section>
    </div>
    <div hidden={section !== 'Transactions'}>
    <section className="heading"><div><span className="eyebrow">YOUR ACTIVITY</span><h2>Transactions</h2></div><label>Month <input aria-label="Transaction month" type="month" value={month} onChange={e => setMonth(e.target.value)} /></label></section>
    <div className="columns"><section className="panel"><span className="eyebrow">KEEP TRACK</span><h2>Add a transaction</h2><p>Record income or an expense in Philippine pesos.</p><div className="entry-mode" role="group" aria-label="Transaction entry method"><button type="button" className="secondary" aria-pressed={entryMode === 'manual'} onClick={() => setEntryMode('manual')}>Manual entry</button><button type="button" className="secondary" aria-pressed={entryMode === 'image'} onClick={() => setEntryMode('image')}>Upload image</button></div><div hidden={entryMode !== 'manual'}><form onSubmit={addEntry}>
      <div className="row"><label>Type<select name="type" value={entryType} onChange={e => setEntryType(e.target.value)}><option value="expense">Expense</option><option value="income">Income</option></select></label><label>Amount (PHP)<input name="amount" type="text" inputMode="decimal" placeholder="0.00" required /></label></div>
      <div className="row"><label>Category<input name="category" placeholder="e.g. Groceries" maxLength="80" required /></label><label>Date<input name="date" type="date" defaultValue={today()} required /></label></div>
      {entryType === 'expense' && <label>Credit card <span className="optional">(optional)</span><select name="card_id"><option value="">No credit card</option>{cards.filter(card => !card.deletedAt).map(card => <option key={card.id} value={card.id}>{card.name}</option>)}{shared?.cards.filter(card => card.accepted_at && !card.revoked_at).map(card => <option key={card.id} value={card.id}>{card.name} (supplementary)</option>)}</select></label>}
      <label>Payment account<input name="account" placeholder="e.g. Cash" maxLength="80" /></label><label>Note <span className="optional">(optional)</span><input name="note" placeholder="Add a note" maxLength="250" /></label>
      {error && <p role="alert" className="error">{error}</p>}<button type={user ? 'submit' : 'button'} onClick={user ? undefined : onSignIn}>{user ? 'Add transaction' : 'Sign in to save'} <span>→</span></button>
    </form></div><div hidden={entryMode !== 'image'}><ImageEntry db={db} cards={cards} onSignIn={onSignIn} /></div></section><section className="panel"><div className="list-heading"><div><span className="eyebrow">YOUR ACTIVITY</span><h2>Transactions</h2></div><button className="secondary" onClick={user ? exportCsv : onSignIn}>{user ? 'Export CSV' : 'Sign in'}</button></div><p>{user ? 'Showing locally available data for the selected month.' : 'Sign in to view your transactions on this device.'}</p>
    {current.length === 0 ? <div className="empty"><div>✳</div><strong>Nothing here yet</strong><p>Your transactions will show up here.</p></div> : <ul>{current.map(entry => <li key={entry.id}><div><strong>{entry.category}</strong><small>{entry.date}{entry.card_id ? ` · ${cards.find(card => card.id === entry.card_id)?.name || shared?.cards.find(card => card.id === entry.card_id)?.name || 'Credit card'}` : ''}{entry.account ? ` · ${entry.account}` : ''}{entry.note ? ` · ${entry.note}` : ''}</small></div><div className="entry-end"><strong className={entry.type === 'income' ? 'positive' : ''}>{entry.type === 'income' ? '+' : '−'}{money(entry.amount)}</strong>{entry.pendingSync ? <small>Waiting to sync</small> : <button className="delete" aria-label={`Delete ${entry.category} transaction`} onClick={() => remove(entry.id, entry.supplementary)}>Delete</button>}</div></li>)}</ul>}
    </section></div></div><div hidden={section !== 'Cards'}><Cards db={db} user={user} cards={cards} entries={entries} reminders={reminders} shared={displayShared} onRefresh={() => syncNow.current?.()} onSignIn={onSignIn} /></div><div hidden={section !== 'Reminders'}><Reminders db={db} user={user} cards={cards} onSignIn={onSignIn} onDueCount={setDueCount} /></div><div hidden={section !== 'Coming up'}><section className="panel feature-list"><span className="eyebrow">COMING UP</span><h2>More ways to plan</h2><p>Category budgets, recurring bills, salary cutoffs and full reports are planned and are not available yet.</p></section></div><footer>Made for a little more peace of mind. <span>PHP · Asia/Manila</span></footer>
  </main>;
}

function ActionsMenu({ label, children }) {
  return <details className="actions-menu" onClick={event => { if (event.target.closest('button')) event.currentTarget.open = false; }}><summary aria-label={label} title={label}>⋯</summary><div className="actions-menu-items">{children}</div></details>;
}

function Cards({ db, user, cards, entries, reminders, shared, onRefresh, onSignIn }) {
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  async function add(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const name = String(data.get('name')).trim();
      if (!name) throw new Error('Enter a card name.');
      await addCard(db, { id: crypto.randomUUID(), name, limit: toCentavos(String(data.get('limit'))) });
      form.reset(); setError('');
    } catch (err) { setError(err.issues?.[0]?.message || err.message || 'Could not save this card.'); }
  }
  async function saveEdit(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      const name = String(data.get('name')).trim();
      if (!name) throw new Error('Enter a card name.');
      await updateCard(db, editing.id, { name, limit: toCentavos(String(data.get('limit'))) }, editing);
      setEditing(null); setError('');
    } catch (err) { setError(err.issues?.[0]?.message || err.message || 'Could not update this card.'); }
  }
  async function removeCard(card) {
    if (!window.confirm(`Remove ${card.name}? Existing transactions and reminders will be kept.`)) return;
    try { await updateCard(db, card.id, { deletedAt: new Date().toISOString() }, card); setEditing(null); setError(''); }
    catch (err) { setError(err.message || 'Could not remove this card.'); }
  }
  return <section className="panel reminder-panel"><span className="eyebrow">YOUR CREDIT</span><h2>Credit cards</h2><p>Cards, recorded expenses and paid reminders sync to your account. Available credit updates after changes sync.</p>
    <form onSubmit={add}><div className="row"><label>Card name<input name="name" maxLength="80" required placeholder="e.g. Visa" /></label><label>Credit limit (PHP)<input name="limit" inputMode="decimal" required placeholder="0.00" /></label></div><button type={db ? 'submit' : 'button'} onClick={db ? undefined : onSignIn}>{db ? 'Add card' : 'Sign in to add a card'}</button></form>
    {error && <p role="alert" className="error">{error}</p>}
    {editing && <form key={editing.id} onSubmit={saveEdit}><h2>Edit card</h2><div className="row"><label>Card name<input name="name" maxLength="80" required defaultValue={editing.name} /></label><label>Credit limit (PHP)<input name="limit" inputMode="decimal" required defaultValue={(editing.limit / 100).toFixed(2)} /></label></div><div className="auth-actions"><button type="submit">Save changes</button><button type="button" className="secondary" onClick={() => setEditing(null)}>Cancel</button></div></form>}
    {cards.some(card => !card.deletedAt) && <ul>{cards.filter(card => !card.deletedAt).map(card => <li key={card.id}><div><strong>{card.name}</strong><small>Credit limit {money(card.limit)}</small></div><div className="card-row-end"><div className="entry-end">{shared ? <><strong>{money(Math.max(0, Math.min(card.limit, availableCredit(card, entries, reminders, [...shared.primaryAllocations, ...shared.allocations]) - supplementarySpent(card.id, shared.cards, shared.transactions))))}</strong><small>Estimated available credit</small></> : <small>Sync to load shared credit</small>}</div><ActionsMenu label={`Actions for ${card.name}`}><button type="button" onClick={() => { setEditing(card); setError(''); }}>Edit</button><button type="button" onClick={() => removeCard(card)}>Remove</button></ActionsMenu></div></li>)}</ul>}
    {user && <SupplementaryCards user={user} cards={cards} shared={shared} onRefresh={onRefresh} />}
  </section>;
}

function SupplementaryCards({ user, cards, shared, onRefresh }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const controller = useRef(null);
  useEffect(() => {
    const abort = new AbortController();
    controller.current = abort;
    return () => abort.abort();
  }, [user.id]);
  async function action(name, args) {
    if (!navigator.onLine) { setError('Connect to manage supplementary cards.'); return false; }
    const signal = controller.current.signal;
    setBusy(true); setError('');
    try { const { error } = await supabase.rpc(name, args).abortSignal(signal); if (error) throw error; if (!signal.aborted) onRefresh(); return !signal.aborted; }
    catch (err) { if (!signal.aborted) setError(err.message || 'Could not update supplementary card.'); return false; }
    finally { if (!signal.aborted) setBusy(false); }
  }
  async function invite(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const name = String(data.get('name')).trim();
      if (!name) throw new Error('Enter a supplementary card name.');
      if (await action('invite_supplementary_card', { p_primary_card_id: data.get('primary'), p_email: String(data.get('email')).trim(), p_name: name, p_limit: toCentavos(String(data.get('limit'))) })) form.reset();
    } catch (err) { setError(err.issues?.[0]?.message || err.message || 'Could not create invitation.'); }
  }
  return <section className="supplementary-cards"><h2>Supplementary cards</h2><p>The cardholder signs in with the invited, confirmed email and accepts here; no email is sent automatically. Supplementary purchases, including their category, account and note, are visible to both participants. Invitations require a connection. Shared credit is estimated from recorded activity and may differ from the bank.</p>
    {cards.some(card => !card.deletedAt) && <form onSubmit={invite}><div className="row"><label>Primary card<select name="primary" required defaultValue=""><option value="" disabled>Choose a card</option>{cards.filter(card => !card.deletedAt).map(card => <option key={card.id} value={card.id}>{card.name}</option>)}</select></label><label>Cardholder email<input type="email" name="email" required maxLength="254" /></label></div><div className="row"><label>Supplementary card name<input name="name" required maxLength="80" /></label><label>Supplementary limit (PHP)<input name="limit" inputMode="decimal" required /></label></div><button disabled={busy} type="submit">Invite cardholder</button></form>}
    {error && <p role="alert" className="error">{error}</p>}
    {!shared ? <p>Connect and sync to load supplementary cards.</p> : shared.cards.some(card => !card.removed_at) && <ul>{shared.cards.filter(card => !card.removed_at).map(card => {
      const balance = shared.balances[card.id];
      const pendingForPrimary = shared.transactions.filter(entry => entry.pendingSync && shared.cards.some(item => item.id === entry.supplementary_card_id && item.primary_card_id === card.primary_card_id)).reduce((sum, entry) => sum + Number(entry.amount), 0);
      const pendingForCard = shared.transactions.filter(entry => entry.pendingSync && entry.supplementary_card_id === card.id).reduce((sum, entry) => sum + Number(entry.amount), 0);
      const sharedAvailable = balance && Math.max(0, Number(balance.shared_available) - pendingForPrimary);
      const supplementaryAvailable = balance && Math.max(0, Math.min(sharedAvailable, Number(balance.supplementary_available) - pendingForCard));
      return <li key={card.id}><div><strong>{card.name}</strong><small>{card.revoked_at ? 'Access revoked' : card.accepted_at ? 'Accepted' : 'Invitation pending'} · {card.owner_id === user.id ? card.invitee_email : 'Shared with you'} · Limit {money(Number(card.credit_limit))}</small>{balance && <small>Shared available {money(sharedAvailable)} · Supplementary available {money(supplementaryAvailable)}</small>}{shared.transactions.filter(entry => entry.supplementary_card_id === card.id && !entry.deleted_at).sort((a, b) => b.date.localeCompare(a.date)).map(entry => <small key={entry.id}>{entry.date} · {entry.category}{entry.account ? ` · ${entry.account}` : ''}{entry.note ? ` · ${entry.note}` : ''} · {money(Number(entry.amount))}{entry.created_by === user.id ? ' · You' : entry.created_by === card.owner_id ? ' · Primary cardholder' : ' · Supplementary cardholder'}{entry.pendingSync ? ' · Pending sync' : ''}</small>)}</div><div className="entry-end">{!card.revoked_at && !card.accepted_at && card.owner_id !== user.id && <button type="button" className="secondary" disabled={busy} onClick={() => action('accept_supplementary_card', { p_id: card.id })}>Accept</button>}{card.owner_id === user.id && <ActionsMenu label={`Actions for ${card.name}`}>{!card.revoked_at && <button type="button" disabled={busy} onClick={() => { if (window.confirm('Revoke access to this supplementary card? Existing purchases will be kept. Unsynced purchases on the cardholder’s device cannot be uploaded after access is revoked.')) action('revoke_supplementary_card', { p_id: card.id }); }}>Revoke access</button>}<button type="button" disabled={busy} onClick={() => { if (window.confirm('Remove this supplementary card? Access will be revoked, but existing purchases will still count toward your primary card balance. Unsynced purchases on the cardholder’s device cannot be uploaded afterward.')) action('remove_supplementary_card', { p_id: card.id }); }}>Remove card</button></ActionsMenu>}</div></li>;
    })}</ul>}
    {shared && shared.cards.some(card => card.owner_id === user.id && card.removed_at && shared.transactions.some(entry => entry.supplementary_card_id === card.id && !entry.deleted_at)) && <details className="removed-card-history"><summary>Removed supplementary card history</summary><ul>{shared.cards.filter(card => card.owner_id === user.id && card.removed_at).map(card => <li key={card.id}><div><strong>{card.name}</strong>{shared.transactions.filter(entry => entry.supplementary_card_id === card.id && !entry.deleted_at).sort((a, b) => b.date.localeCompare(a.date)).map(entry => <small key={entry.id}>{entry.date} · {entry.category}{entry.account ? ` · ${entry.account}` : ''}{entry.note ? ` · ${entry.note}` : ''} · {money(Number(entry.amount))}</small>)}</div></li>)}</ul></details>}
  </section>;
}

function Reminders({ db, user, cards, onSignIn, onDueCount }) {
  const [reminders, setReminders] = useState([]);
  const [editing, setEditing] = useState(null);
  const [statementReview, setStatementReview] = useState(null);
  const [error, setError] = useState('');
  const [date, setDate] = useState('');
  const sharedController = useRef(null);
  const statementHeading = useRef(null);
  const reviewId = statementReview?.reminder.id;
  useEffect(() => { if (reviewId) statementHeading.current?.focus(); }, [reviewId]);
  useEffect(() => {
    const controller = new AbortController();
    sharedController.current = controller;
    const update = () => setDate(today());
    update();
    window.addEventListener('focus', update);
    const subscription = db && liveQuery(() => db.reminders.orderBy('dueDate').toArray()).subscribe({ next: items => setReminders(items.filter(item => !item.deleted)), error: () => setError('Could not read reminders.') });
    return () => { controller.abort(); window.removeEventListener('focus', update); subscription?.unsubscribe(); };
  }, [db]);

  async function add(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const title = String(data.get('title')).trim();
    if (!title) { setError('Enter a payment name.'); return; }
    try {
      const cardId = String(data.get('cardId') || '');
      if (cardId && !cards.some(card => card.id === cardId && !card.deletedAt)) throw new Error('Select a valid credit card.');
      const amount = cardId ? toCentavos(String(data.get('amount'))) : 0;
      const id = crypto.randomUUID();
      const time = String(data.get('notifyTime') || '');
      const sendAt = time ? reminderSendAt(String(data.get('dueDate')), time) : '';
      const statementDate = String(data.get('statementDate') || '');
      if (statementDate && !cardId) throw new Error('Choose a primary card for a statement closing date.');
      if (sendAt && new Date(sendAt) <= new Date()) throw new Error('Choose a future notification time.');
      await addReminder(db, { id, title, dueDate: data.get('dueDate'), paid: false, cardId, amount, sendAt, statementDate });
      form.reset(); setError('');
    } catch (err) { setError(err.issues?.[0]?.message || err.message || 'Could not save this reminder on this device.'); }
  }

  async function markPaid(reminder) {
    try {
      if (!reminder.paid && reminder.cardId) {
        if (!navigator.onLine) throw new Error('Connect to review supplementary purchases before recording a card payment.');
        if (await db.syncQueue.count()) throw new Error('Sync pending changes before recording this card payment.');
        await syncTransactions(db, user.id, sharedController.current.signal);
        if (sharedController.current.signal.aborted) return;
        if (await db.syncQueue.count()) throw new Error('Sync pending changes before recording this card payment.');
        const fresh = await loadSupplementary(supabase, sharedController.current.signal);
        if (sharedController.current.signal.aborted) return;
        const hasSupplementary = fresh.cards.some(card => card.primary_card_id === reminder.cardId && card.owner_id === user.id && card.accepted_at);
        if (hasSupplementary && !reminder.statementDate) throw new Error('Edit this reminder to add the statement closing date before paying.');
        if (reminder.statementDate) {
          if (reminder.statementDate > today()) throw new Error('The statement closing date cannot be in the future.');
          const purchases = statementPurchases(reminder.cardId, reminder.statementDate, fresh.cards, fresh.transactions, fresh.allocations);
          const alreadyPaid = new Set(fresh.primaryAllocations.map(item => item.transaction_id));
          const primary = (await db.transactions.toArray()).filter(entry => entry.card_id === reminder.cardId && entry.type === 'expense' && entry.date <= reminder.statementDate && !alreadyPaid.has(entry.id));
          if (sharedController.current.signal.aborted) return;
          setStatementReview({ reminder, items: [...primary.map(entry => ({ ...entry, card: 'primary', selected: false })), ...purchases.map(entry => ({ ...entry, card: 'supplementary', selected: false }))] });
          setError('');
          return;
        }
      }
      await setReminderPaid(db, reminder.id, !reminder.paid); setError('');
    } catch (error) { if (!sharedController.current?.signal.aborted) setError(error.message || 'Could not update this reminder.'); }
  }

  async function confirmStatement(event) {
    event.preventDefault();
    try {
      if (await db.syncQueue.count()) throw new Error('Sync pending changes before recording this card payment.');
      const selected = statementReview.items.filter(item => item.selected);
      const total = selected.reduce((sum, item) => sum + Number(item.amount), 0);
      if (total > statementReview.reminder.amount) throw new Error('Selected purchases exceed the payment amount.');
      await updateReminder(db, statementReview.reminder.id, { paid: true, statementAllocations: selected.map(item => ({ transactionId: item.id, card: item.card, amount: Number(item.amount) })) }, statementReview.reminder.syncVersion);
      setStatementReview(null); setError('');
    } catch (err) { setError(err.message || 'Could not record the statement payment.'); }
  }

  async function saveEdit(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      const title = String(data.get('title')).trim();
      if (!title) throw new Error('Enter a payment name.');
      const cardId = String(data.get('cardId') || '');
      if (cardId && cardId !== editing.cardId && !cards.some(card => card.id === cardId && !card.deletedAt)) throw new Error('Select a valid credit card.');
      const amount = cardId ? toCentavos(String(data.get('amount'))) : 0;
      const dueDate = String(data.get('dueDate'));
      const statementDate = String(data.get('statementDate') || '');
      if (statementDate && !cardId) throw new Error('Choose a primary card for a statement closing date.');
      if (editing.paid && (statementDate !== (editing.statementDate || '') || cardId !== (editing.cardId || '') || amount !== editing.amount)) throw new Error('Undo the payment before changing its card, amount or statement date.');
      const time = String(data.get('notifyTime') || '');
      const sendAt = time ? reminderSendAt(dueDate, time) : '';
      if (sendAt && sendAt !== (editing.sendAt || '') && new Date(sendAt) <= new Date()) throw new Error('Choose a future notification time.');
      await updateReminder(db, editing.id, { title, dueDate, cardId, amount, sendAt, statementDate }, editing.syncVersion);
      setEditing(null); setError('');
    } catch (err) { setError(err.issues?.[0]?.message || err.message || 'Could not update this reminder.'); }
  }

  async function removeReminder(reminder) {
    if (!window.confirm(`Delete ${reminder.title}?${reminder.paid && reminder.cardId ? ' Its payment will no longer replenish the card balance.' : ''}`)) return;
    try { await updateReminder(db, reminder.id, { deleted: true }, reminder.syncVersion); setEditing(null); setError(''); }
    catch (err) { setError(err.message || 'Could not delete this reminder.'); }
  }

  const due = reminders.filter(reminder => !reminder.paid && reminder.dueDate <= date);
  useEffect(() => { onDueCount(due.length); }, [due.length, onDueCount]);
  return <section className="panel reminder-panel"><span className="eyebrow">PAYMENT CHECKLIST</span><h2>Remind me</h2><p>Reminders sync to your account. Enable notifications and choose a time for an alert on the due date (Asia/Manila). Offline changes take effect on the server after sync.</p><EnableNotificationsButton user={user} onSignIn={onSignIn} />
    {due.length > 0 && <aside className="notice reminder-alert" role="status"><strong>{due.length} payment{due.length === 1 ? '' : 's'} due or overdue.</strong> Review your checklist below.</aside>}
    <form onSubmit={add}><div className="row"><label>Payment name<input name="title" maxLength="80" required placeholder="e.g. Internet bill" /></label><label>Due date<input name="dueDate" type="date" required /></label></div><label>Notification time (Asia/Manila) <span className="optional">(optional)</span><input name="notifyTime" type="time" /></label><div className="row"><label>Credit card <span className="optional">(optional)</span><select name="cardId"><option value="">No credit card</option>{cards.filter(card => !card.deletedAt).map(card => <option key={card.id} value={card.id}>{card.name}</option>)}</select></label><label>Card payment amount (PHP)<input name="amount" inputMode="decimal" placeholder="0.00" /></label></div><label>Statement closing date <span className="optional">(required when paying a shared card)</span><input name="statementDate" type="date" /></label><button type={db ? 'submit' : 'button'} onClick={db ? undefined : onSignIn}>{db ? 'Add reminder' : 'Sign in to save a reminder'}</button></form>
    {editing && <form key={editing.id} onSubmit={saveEdit}><h2>Edit reminder</h2><div className="row"><label>Payment name<input name="title" maxLength="80" required defaultValue={editing.title} /></label><label>Due date<input name="dueDate" type="date" required defaultValue={editing.dueDate} /></label></div><label>Notification time (Asia/Manila) <span className="optional">(optional)</span><input name="notifyTime" type="time" defaultValue={editing.sendAt ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(editing.sendAt)) : ''} /></label><div className="row"><label>Credit card <span className="optional">(optional)</span><select name="cardId" defaultValue={editing.cardId || ''}><option value="">No credit card</option>{cards.filter(card => !card.deletedAt || card.id === editing.cardId).map(card => <option key={card.id} value={card.id}>{card.name}{card.deletedAt ? ' (removed)' : ''}</option>)}</select></label><label>Card payment amount (PHP)<input name="amount" inputMode="decimal" defaultValue={editing.amount ? (editing.amount / 100).toFixed(2) : ''} placeholder="0.00" /></label></div><label>Statement closing date <span className="optional">(required when paying a shared card)</span><input name="statementDate" type="date" defaultValue={editing.statementDate || ''} /></label><div className="auth-actions"><button type="submit">Save changes</button><button type="button" className="secondary" onClick={() => setEditing(null)}>Cancel</button></div></form>}
    {statementReview && <form onSubmit={confirmStatement}><h2 ref={statementHeading} tabIndex="-1">Review statement payment</h2><p>Select only purchases included in this bill. Earlier payments may not have recorded which purchases they covered. Later purchases remain outstanding.</p><p>Payment: {money(statementReview.reminder.amount)} · Closing date: {statementReview.reminder.statementDate}</p>{statementReview.items.length > 0 && <div className="auth-actions"><button type="button" className="secondary" onClick={() => setStatementReview(review => ({ ...review, items: review.items.map(item => ({ ...item, selected: true })) }))}>Select all listed</button><button type="button" className="secondary" onClick={() => setStatementReview(review => ({ ...review, items: review.items.map(item => ({ ...item, selected: false })) }))}>Clear selection</button></div>}{statementReview.items.map(item => <label className="history-select statement-item" key={`${item.card}-${item.id}`}><input type="checkbox" checked={item.selected} onChange={event => { const checked = event.target.checked; setStatementReview(review => ({ ...review, items: review.items.map(entry => entry.card === item.card && entry.id === item.id ? { ...entry, selected: checked } : entry) })); }} /> <span>{item.date} · {item.card === 'primary' ? 'Primary' : 'Supplementary'} · {item.category}{item.note ? ` · ${item.note}` : ''} · {money(Number(item.amount))}</span></label>)}<p>Selected: {money(statementReview.items.filter(item => item.selected).reduce((sum, item) => sum + Number(item.amount), 0))}. Only selected recorded purchases replenish estimated credit.</p><div className="auth-actions"><button type="submit">Confirm payment</button><button type="button" className="secondary" onClick={() => setStatementReview(null)}>Cancel</button></div></form>}
    {error && <p role="alert" className="error">{error}</p>}
    {db && reminders.length > 0 && <ul>{reminders.map(reminder => <li key={reminder.id}><div><strong>{reminder.title}</strong><small>{reminder.dueDate} · {paymentStatus(reminder, date)}{reminder.sendAt ? ` · alert ${new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' }).format(new Date(reminder.sendAt))}` : ''}{reminder.cardId ? ` · ${cards.find(card => card.id === reminder.cardId)?.name || 'Credit card'} · ${money(reminder.amount)}` : ''}</small></div><ActionsMenu label={`Actions for ${reminder.title}`}><button type="button" onClick={() => markPaid(reminder)}>{reminder.paid ? 'Undo payment' : 'Mark paid'}</button><button type="button" onClick={() => { setEditing(reminder); setError(''); }}>Edit</button><button type="button" onClick={() => removeReminder(reminder)}>Delete</button></ActionsMenu></li>)}</ul>}
  </section>;
}
