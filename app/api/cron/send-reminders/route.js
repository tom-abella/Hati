import { createClient } from '@supabase/supabase-js';
import * as webpush from 'web-push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  if (!process.env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY || !process.env.VAPID_SUBJECT) return Response.json({ error: 'Push is not configured.' }, { status: 500 });
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  webpush.setVapidDetails(process.env.VAPID_SUBJECT, process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  const { data: reminders, error } = await db.from('reminders').select('id,user_id,title,body,url').is('sent_at', null).lte('send_at', new Date().toISOString()).order('send_at').limit(100);
  if (error) return Response.json({ error: 'Could not load reminders.' }, { status: 500 });
  let processed = 0;
  for (const reminder of reminders) {
    const { data: claimed, error: claimError } = await db.from('reminders').update({ sent_at: new Date().toISOString() }).eq('id', reminder.id).is('sent_at', null).select('id').maybeSingle();
    if (claimError) return Response.json({ error: 'Could not claim reminder.', processed }, { status: 500 });
    if (!claimed) continue;
    processed++;
    const { data: subscriptions, error: subscriptionError } = await db.from('push_subscriptions').select('id,endpoint,p256dh,auth').eq('user_id', reminder.user_id);
    if (subscriptionError) return Response.json({ error: 'Could not load subscriptions.', processed }, { status: 500 });
    for (const subscription of subscriptions) {
      try {
        await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, JSON.stringify({ title: reminder.title, body: reminder.body, url: reminder.url }));
      } catch (error) {
        if (error.statusCode === 404 || error.statusCode === 410) {
          const result = await db.from('push_subscriptions').delete().eq('id', subscription.id);
          if (result.error) console.error('Could not remove expired push subscription.', result.error.message);
        } else console.error('Push delivery failed.', error.statusCode || error.message);
      }
    }
  }
  return Response.json({ processed });
}
