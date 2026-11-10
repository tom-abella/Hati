# Hati budget — early preview

This is an incomplete prototype. Guests can browse; signing in is required to view or save account-specific local records. It is **not ready for financial records**: transaction sync requires the migration below and has not been tested against the hosted project; cards, bills, budgets, cutoff planning, and scheduled push are incomplete. Anyone with access to this browser profile can read local data, and browser storage can be cleared. Do not enter card numbers or sensitive information.

## Run

Requires Node.js 20.9 or later. Run `npm install`, `npm run build`, and `npm start`. Open `http://localhost:3000`. The service worker is disabled in development; offline behavior requires a production build and HTTPS (localhost is also supported). An initial online load is required. Installability on iOS and offline reopening have not been verified on a physical device. The SVG icon still needs iOS-compatible PNG icons.

Income and expenses are stored per account in IndexedDB in integer centavos, with an atomic queue for transaction creates and deletes. Existing account transactions are queued once on upgrade. After the database migration is applied, sync runs on app open, focus, reconnect, and local changes; pending count and last sync appear in the app. Supabase records use ownership policies, unique IDs and deletion tombstones. Existing records from the separate `hati-local-preview` database are not imported. The monthly view and CSV use local data. A signed-in user can add a local payment checklist: due and overdue items are flagged when the app is opened or focused. This is not a scheduled notification: the app cannot alert while closed, and reminders are not synced or backed up. Marking a reminder paid only updates the local checklist.

Image entry currently saves JPEG, PNG or WebP drafts and accepts manually confirmed PHP details; automatic image extraction is not implemented. Do not upload photos containing full card numbers, CVVs or credentials. Images remain unencrypted in local browser storage. Confirmed expense images create a transaction queued for sync; images, bill and statement references remain local and do not create bills, payment occurrences or reminders. Clearing browser storage can delete them.

### Email confirmation troubleshooting

Supabase's default email service only sends to addresses belonging to the project's organization team and is currently limited to two emails per hour, best effort. For other addresses, configure [custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp) in Supabase Authentication settings. Check the spam folder and Auth logs for delivery or rate-limit errors. In **Authentication → URL Configuration**, set the Site URL to the actual app URL: `http://localhost:3000` works only on the computer running the app, not on an iPhone. After deployment, use the HTTPS app URL.

## Database setup

If the transaction table does not yet exist, run `supabase/migrations/20261110000000_transactions.sql` once. Then run `supabase/migrations/20261110000001_transaction_sync.sql` in the Supabase SQL Editor. The second migration adds a deletion timestamp needed by sync; do not rerun the first migration on an existing table. The app uses the signed-in user's publishable-key client and RLS. Sync and RLS have not yet been verified against the hosted project; test with two accounts and two devices before relying on it. Do not use the database dashboard to physically delete rows: sync relies on tombstones. The app currently supports creating and deleting transactions, not editing them or conflict resolution for edits made outside the app. Images and other entities are not synced. Never expose a secret or service-role key.

## Platform notes

Checked November 2026: [Next.js](https://nextjs.org/docs/app/getting-started/installation) requires Node 20.9+; [Serwist's Next integration](https://serwist.pages.dev/docs/next/getting-started) supports webpack, used by the build script. [Supabase Free](https://supabase.com/pricing) includes 500 MB database storage, 500,000 Edge Function invocations and two active projects, but projects may pause after one week of inactivity. [Vercel Hobby](https://vercel.com/docs/plans/hobby) is free for non-commercial personal use and has usage limits; exceeding limits may interrupt service. Limits can change.

Before this can meet the requested design it needs hosted sync and ownership testing, edit/conflict handling, a safe import of legacy preview entries, syncing of other entities and images, recurring occurrences and payment allocations, configurable cutoffs, scheduled device-specific Web Push, reports, and end-to-end security and physical iPhone tests. Offline payment changes cannot stop a server reminder until synced; push needs connectivity and notification permission in an iOS Home Screen app, and delivery is not exact. A free project pausing can stop reminders.
