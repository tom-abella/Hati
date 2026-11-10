-- This table is not yet connected to the local preview or a sync queue.
create table public.transactions (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  type text not null check (type in ('income', 'expense')),
  amount bigint not null check (amount > 0 and amount <= 999999999999),
  category text not null check (char_length(btrim(category)) between 1 and 80),
  date date not null,
  account text not null default '' check (char_length(account) <= 80),
  note text not null default '' check (char_length(note) <= 250),
  created_at timestamptz not null default now()
);

alter table public.transactions enable row level security;
revoke all on public.transactions from anon, authenticated;
grant select, insert, update, delete on public.transactions to authenticated;

create policy "Users can read their transactions" on public.transactions
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can add their transactions" on public.transactions
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update their transactions" on public.transactions
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete their transactions" on public.transactions
  for delete to authenticated using ((select auth.uid()) = user_id);
