'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { liveQuery } from 'dexie';
import { accountDb } from '@/lib/db';
import { money, toCentavos } from '@/lib/money';
import { paymentStatus, reminderSendAt } from '@/lib/reminders';
import { availableCredit } from '@/lib/cards';
import { supabase } from '@/lib/supabase';
import ImageEntry from './image-entry';
import EnableNotificationsButton from './enable-notifications-button';
import { addTransaction, deleteTransaction, syncTransactions } from '@/lib/sync';

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
  const [lastSync, setLastSync] = useState('');
  const [syncMessage, setSyncMessage] = useState('');

  useEffect(() => {
    setMonth(today().slice(0, 7));
    if (new URLSearchParams(window.location.search).get('section') === 'reminders') setSection('Reminders');
    const updateOnline = () => setOnline(navigator.onLine);
    updateOnline();
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    const subscription = db && liveQuery(() => db.transactions.orderBy('date').reverse().toArray()).subscribe({ next: setEntries, error: () => setError('Could not read local storage.') });
    const cardSubscription = db && liveQuery(async () => ({ cards: await db.cards.toArray(), reminders: await db.reminders.toArray() })).subscribe({ next: data => { setCards(data.cards); setReminders(data.reminders); }, error: () => setError('Could not read cards.') });
    return () => { window.removeEventListener('online', updateOnline); window.removeEventListener('offline', updateOnline); subscription?.unsubscribe(); cardSubscription?.unsubscribe(); };
  }, [db]);

  useEffect(() => {
    if (!db || !user) return;
    const controller = new AbortController();
    const sync = () => {
      if (!navigator.onLine || controller.signal.aborted) return;
      setSyncMessage('Syncing transactions…');
      syncTransactions(db, user.id, controller.signal).then(async () => {
        if (!controller.signal.aborted) {
          setSyncMessage('');
          if (await db.syncQueue.count()) sync();
        }
      }).catch(error => {
        if (!controller.signal.aborted) setSyncMessage(`Sync failed: ${error.message || 'try again when online.'}`);
      });
    };
    const subscription = liveQuery(async () => ({ count: await db.syncQueue.count(), last: await db.syncMeta.get('lastSync') })).subscribe({ next: ({ count, last }) => { setPending(count); setLastSync(last?.value || ''); if (count) sync(); }, error: () => setSyncMessage('Could not read sync status.') });
    window.addEventListener('online', sync);
    window.addEventListener('focus', sync);
    sync();
    return () => { controller.abort(); subscription.unsubscribe(); window.removeEventListener('online', sync); window.removeEventListener('focus', sync); };
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
      if (cardId && (data.get('type') !== 'expense' || !cards.some(card => card.id === cardId))) throw new Error('Select a valid credit card for an expense.');
      await addTransaction(db, { id: crypto.randomUUID(), type: data.get('type'), amount, category, date: data.get('date'), account: String(data.get('account')).trim(), note: String(data.get('note')).trim(), card_id: cardId });
      form.reset();
      setEntryType('expense');
      setError('');
    } catch (err) { setError(err.issues?.[0]?.message || err.message || 'Could not save this entry on this device.'); }
  }

  async function remove(id) {
    if (!window.confirm('Delete this entry?')) return;
    try { await deleteTransaction(db, id); } catch { setError('Could not delete this entry.'); }
  }

  const current = entries.filter(entry => entry.date.startsWith(month));
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
    <aside className="notice"><strong>Early preview.</strong> {user ? `Transactions: ${pending} pending change${pending === 1 ? '' : 's'}. Last successful sync: ${lastSync ? new Date(lastSync).toLocaleString() : 'never'}.` : 'Browse as a guest; sign in to save or view personal entries.'} {syncMessage} Cards and checklist entries stay on this device. Scheduled notifications require setup and connectivity.</aside>
    {dueCount > 0 && section !== 'Reminders' && <aside className="notice" role="status"><strong>{dueCount} payment{dueCount === 1 ? '' : 's'} due or overdue.</strong> <button className="secondary" onClick={() => setSection('Reminders')}>View reminders</button></aside>}
    <div hidden={section !== 'Overview'}>
    <section className="heading"><div><span className="eyebrow">YOUR OVERVIEW</span><h2>Monthly snapshot</h2></div><label>Month <input aria-label="Report month" type="month" value={month} onChange={e => setMonth(e.target.value)} /></label></section>
    <section className="stats"><article className="stat dark"><span>Left after expenses</span><strong>{money(income - expenses)}</strong><small>Income less spending</small></article><article className="stat"><span>Income</span><strong>{money(income)}</strong><small>This month</small></article><article className="stat"><span>Expenses</span><strong>{money(expenses)}</strong><small>This month</small></article></section>
    </div>
    <div hidden={section !== 'Transactions'}>
    <section className="heading"><div><span className="eyebrow">YOUR ACTIVITY</span><h2>Transactions</h2></div><label>Month <input aria-label="Transaction month" type="month" value={month} onChange={e => setMonth(e.target.value)} /></label></section>
    <div className="columns"><section className="panel"><span className="eyebrow">KEEP TRACK</span><h2>Add a transaction</h2><p>Record income or an expense in Philippine pesos.</p><div className="entry-mode" role="group" aria-label="Transaction entry method"><button type="button" className="secondary" aria-pressed={entryMode === 'manual'} onClick={() => setEntryMode('manual')}>Manual entry</button><button type="button" className="secondary" aria-pressed={entryMode === 'image'} onClick={() => setEntryMode('image')}>Upload image</button></div><div hidden={entryMode !== 'manual'}><form onSubmit={addEntry}>
      <div className="row"><label>Type<select name="type" value={entryType} onChange={e => setEntryType(e.target.value)}><option value="expense">Expense</option><option value="income">Income</option></select></label><label>Amount (PHP)<input name="amount" type="text" inputMode="decimal" placeholder="0.00" required /></label></div>
      <div className="row"><label>Category<input name="category" placeholder="e.g. Groceries" maxLength="80" required /></label><label>Date<input name="date" type="date" defaultValue={today()} required /></label></div>
      {entryType === 'expense' && <label>Credit card <span className="optional">(optional)</span><select name="card_id"><option value="">No credit card</option>{cards.map(card => <option key={card.id} value={card.id}>{card.name}</option>)}</select></label>}
      <label>Payment account<input name="account" placeholder="e.g. Cash" maxLength="80" /></label><label>Note <span className="optional">(optional)</span><input name="note" placeholder="Add a note" maxLength="250" /></label>
      {error && <p role="alert" className="error">{error}</p>}<button type={user ? 'submit' : 'button'} onClick={user ? undefined : onSignIn}>{user ? 'Add transaction' : 'Sign in to save'} <span>→</span></button>
    </form></div><div hidden={entryMode !== 'image'}><ImageEntry db={db} cards={cards} onSignIn={onSignIn} /></div></section><section className="panel"><div className="list-heading"><div><span className="eyebrow">YOUR ACTIVITY</span><h2>Transactions</h2></div><button className="secondary" onClick={user ? exportCsv : onSignIn}>{user ? 'Export CSV' : 'Sign in'}</button></div><p>{user ? 'Showing locally available data for the selected month.' : 'Sign in to view your transactions on this device.'}</p>
    {current.length === 0 ? <div className="empty"><div>✳</div><strong>Nothing here yet</strong><p>Your transactions will show up here.</p></div> : <ul>{current.map(entry => <li key={entry.id}><div><strong>{entry.category}</strong><small>{entry.date}{entry.card_id ? ` · ${cards.find(card => card.id === entry.card_id)?.name || 'Credit card'}` : ''}{entry.account ? ` · ${entry.account}` : ''}{entry.note ? ` · ${entry.note}` : ''}</small></div><div className="entry-end"><strong className={entry.type === 'income' ? 'positive' : ''}>{entry.type === 'income' ? '+' : '−'}{money(entry.amount)}</strong><button className="delete" aria-label={`Delete ${entry.category} transaction`} onClick={() => remove(entry.id)}>Delete</button></div></li>)}</ul>}
    </section></div></div><div hidden={section !== 'Cards'}><Cards db={db} cards={cards} entries={entries} reminders={reminders} onSignIn={onSignIn} /></div><div hidden={section !== 'Reminders'}><Reminders db={db} user={user} cards={cards} onSignIn={onSignIn} onDueCount={setDueCount} /></div><div hidden={section !== 'Coming up'}><section className="panel feature-list"><span className="eyebrow">COMING UP</span><h2>More ways to plan</h2><p>Category budgets, recurring bills, salary cutoffs and full reports are planned and are not available yet.</p></section></div><footer>Made for a little more peace of mind. <span>PHP · Asia/Manila</span></footer>
  </main>;
}

function Cards({ db, cards, entries, reminders, onSignIn }) {
  const [error, setError] = useState('');
  async function add(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const name = String(data.get('name')).trim();
      if (!name) throw new Error('Enter a card name.');
      await db.cards.add({ id: crypto.randomUUID(), name, limit: toCentavos(String(data.get('limit'))) });
      form.reset(); setError('');
    } catch (err) { setError(err.issues?.[0]?.message || err.message || 'Could not save this card.'); }
  }
  return <section className="panel reminder-panel"><span className="eyebrow">YOUR CREDIT</span><h2>Credit cards</h2><p>Available credit reflects recorded card expenses and paid card reminders. Cards stay on this device.</p>
    <form onSubmit={add}><div className="row"><label>Card name<input name="name" maxLength="80" required placeholder="e.g. Visa" /></label><label>Credit limit (PHP)<input name="limit" inputMode="decimal" required placeholder="0.00" /></label></div><button type={db ? 'submit' : 'button'} onClick={db ? undefined : onSignIn}>{db ? 'Add card' : 'Sign in to add a card'}</button></form>
    {error && <p role="alert" className="error">{error}</p>}
    {cards.length > 0 && <ul>{cards.map(card => <li key={card.id}><div><strong>{card.name}</strong><small>Credit limit {money(card.limit)}</small></div><div className="entry-end"><strong>{money(availableCredit(card, entries, reminders))}</strong><small>Available credit</small></div></li>)}</ul>}
  </section>;
}

function Reminders({ db, user, cards, onSignIn, onDueCount }) {
  const [reminders, setReminders] = useState([]);
  const [error, setError] = useState('');
  const [date, setDate] = useState('');
  useEffect(() => {
    const update = () => setDate(today());
    update();
    window.addEventListener('focus', update);
    const subscription = db && liveQuery(() => db.reminders.orderBy('dueDate').toArray()).subscribe({ next: setReminders, error: () => setError('Could not read reminders.') });
    return () => { window.removeEventListener('focus', update); subscription?.unsubscribe(); };
  }, [db]);

  async function add(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const title = String(data.get('title')).trim();
    if (!title) { setError('Enter a payment name.'); return; }
    try {
      const cardId = String(data.get('cardId') || '');
      if (cardId && !cards.some(card => card.id === cardId)) throw new Error('Select a valid credit card.');
      const amount = cardId ? toCentavos(String(data.get('amount'))) : 0;
      const id = crypto.randomUUID();
      const time = String(data.get('notifyTime') || '');
      const sendAt = time ? reminderSendAt(String(data.get('dueDate')), time) : '';
      if (sendAt && new Date(sendAt) <= new Date()) throw new Error('Choose a future notification time.');
      if (sendAt) {
        const { error } = await supabase.from('reminders').insert({ id, user_id: user.id, title: 'Payment reminder', body: `${title} is due today.`, url: '/?section=reminders', send_at: sendAt });
        if (error) throw new Error('Could not schedule the notification. Check your connection and try again.');
      }
      try { await db.reminders.add({ id, title, dueDate: data.get('dueDate'), paid: false, cardId, amount, sendAt }); }
      catch (error) { if (sendAt) await supabase.from('reminders').delete().eq('id', id); throw error; }
      form.reset(); setError('');
    } catch (err) { setError(err.issues?.[0]?.message || err.message || 'Could not save this reminder on this device.'); }
  }

  async function markPaid(reminder) {
    try {
      if (reminder.sendAt && (!reminder.paid || new Date(reminder.sendAt) > new Date())) {
        const { data, error } = await supabase.from('reminders').update({ sent_at: reminder.paid ? null : new Date().toISOString() }).eq('id', reminder.id).select('id').maybeSingle();
        if (error || !data) throw new Error('Connect to update this scheduled reminder.');
      }
      await db.reminders.update(reminder.id, { paid: !reminder.paid }); setError('');
    } catch (error) { setError(error.message || 'Could not update this reminder.'); }
  }

  const due = reminders.filter(reminder => !reminder.paid && reminder.dueDate <= date);
  useEffect(() => { onDueCount(due.length); }, [due.length, onDueCount]);
  return <section className="panel reminder-panel"><span className="eyebrow">PAYMENT CHECKLIST</span><h2>Remind me</h2><p>Checklist entries stay on this device. Enable notifications and choose a time to schedule an alert for the due date (Asia/Manila). Scheduling and updating scheduled payments requires a connection.</p><EnableNotificationsButton user={user} onSignIn={onSignIn} />
    {due.length > 0 && <aside className="notice reminder-alert" role="status"><strong>{due.length} payment{due.length === 1 ? '' : 's'} due or overdue.</strong> Review your checklist below.</aside>}
    <form onSubmit={add}><div className="row"><label>Payment name<input name="title" maxLength="80" required placeholder="e.g. Internet bill" /></label><label>Due date<input name="dueDate" type="date" required /></label></div><label>Notification time (Asia/Manila) <span className="optional">(optional)</span><input name="notifyTime" type="time" /></label><div className="row"><label>Credit card <span className="optional">(optional)</span><select name="cardId"><option value="">No credit card</option>{cards.map(card => <option key={card.id} value={card.id}>{card.name}</option>)}</select></label><label>Card payment amount (PHP)<input name="amount" inputMode="decimal" placeholder="0.00" /></label></div><button type={db ? 'submit' : 'button'} onClick={db ? undefined : onSignIn}>{db ? 'Add reminder' : 'Sign in to save a reminder'}</button></form>
    {error && <p role="alert" className="error">{error}</p>}
    {db && reminders.length > 0 && <ul>{reminders.map(reminder => <li key={reminder.id}><div><strong>{reminder.title}</strong><small>{reminder.dueDate} · {paymentStatus(reminder, date)}{reminder.sendAt ? ` · alert ${new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' }).format(new Date(reminder.sendAt))}` : ''}{reminder.cardId ? ` · ${cards.find(card => card.id === reminder.cardId)?.name || 'Credit card'} · ${money(reminder.amount)}` : ''}</small></div><button className="secondary" onClick={() => markPaid(reminder)}>{reminder.paid ? 'Undo payment' : 'Mark paid'}</button></li>)}</ul>}
  </section>;
}
