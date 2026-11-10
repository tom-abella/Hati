-- Tombstones let devices observe deletions without mistaking an incomplete download for a delete.
alter table public.transactions add column if not exists deleted_at timestamptz;
