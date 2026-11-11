'use client';

import { useEffect, useState } from 'react';
import { subscribeToPush, unsubscribeFromPush } from '@/lib/push';
import { supabase } from '@/lib/supabase';

export default function EnableNotificationsButton({ user, onSignIn }) {
  const [state, setState] = useState('disabled');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const userId = user?.id;
  useEffect(() => {
    const controller = new AbortController();
    Promise.resolve().then(async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
      if (Notification.permission === 'denied') return 'denied';
      const registration = await navigator.serviceWorker.getRegistration('/');
      const subscription = await registration?.pushManager.getSubscription();
      if (!subscription || !userId || Notification.permission !== 'granted') return 'disabled';
      const { data, error } = await supabase.from('push_subscriptions').select('id').eq('endpoint', subscription.endpoint).eq('user_id', userId).maybeSingle();
      if (error) throw error;
      return data ? 'enabled' : 'disabled';
    }).then(status => { if (!controller.signal.aborted) setState(status); }).catch(() => { if (!controller.signal.aborted) setMessage('Could not read notification status.'); });
    return () => controller.abort();
  }, [userId]);

  async function toggle() {
    if (!user) { onSignIn(); return; }
    setBusy(true); setMessage('');
    try {
      if (state === 'enabled') { await unsubscribeFromPush(); setState('disabled'); }
      else { await subscribeToPush(); setState('enabled'); }
    } catch (error) { if (Notification.permission === 'denied') setState('denied'); setMessage(error.message || 'Could not update notifications.'); }
    finally { setBusy(false); }
  }
  return <div className="notification-controls"><p>Notifications: {state === 'unsupported' ? 'unsupported on this device' : state === 'denied' ? 'permission denied in browser settings' : state}.</p>{state !== 'unsupported' && state !== 'denied' && <button type="button" className="secondary" disabled={busy} onClick={toggle}>{state === 'enabled' ? 'Disable notifications' : 'Enable notifications'}</button>}{message && <p role="alert" className="error">{message}</p>}</div>;
}
