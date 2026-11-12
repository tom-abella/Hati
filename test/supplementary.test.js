import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSupplementary, statementPurchases, supplementarySpent } from '../lib/supplementary.js';

test('shared spending and statement selection exclude deleted, later and previously paid purchases', () => {
  const cards = [{ id: 's', primary_card_id: 'main', removed_at: '2026-11-03' }, { id: 'other', primary_card_id: 'elsewhere' }];
  const entries = [
    { id: 'old', supplementary_card_id: 's', date: '2026-11-01', amount: 100 },
    { id: 'paid', supplementary_card_id: 's', date: '2026-11-02', amount: 200 },
    { id: 'later', supplementary_card_id: 's', date: '2026-11-12', amount: 300 },
    { id: 'deleted', supplementary_card_id: 's', date: '2026-11-01', amount: 400, deleted_at: '2026-11-02' },
    { id: 'other', supplementary_card_id: 'other', date: '2026-11-01', amount: 500 },
  ];
  assert.equal(supplementarySpent('main', cards, entries), 600);
  assert.deepEqual(statementPurchases('main', '2026-11-10', cards, entries, [{ transaction_id: 'paid' }]).map(item => item.id), ['old']);
});

test('shared data loader fetches balances only for accepted active cards', async () => {
  const records = {
    supplementary_cards: [{ id: 'active', accepted_at: '2026-01-01', revoked_at: null }, { id: 'pending', accepted_at: null }, { id: 'revoked', accepted_at: '2026-01-01', revoked_at: '2026-02-01' }],
    supplementary_transactions: [], supplementary_statement_allocations: [], primary_statement_allocations: [],
  };
  const calls = [];
  const client = {
    from(table) { return { select() { return this; }, order() { return this; }, limit() { return this; }, abortSignal: async () => ({ data: records[table], error: null }) }; },
    rpc(_name, params) { calls.push(params.p_id); return { abortSignal() { return this; }, maybeSingle: async () => ({ data: { shared_available: 10 }, error: null }) }; },
  };
  const result = await loadSupplementary(client, new AbortController().signal);
  assert.deepEqual(calls, ['active']);
  assert.equal(result.balances.active.shared_available, 10);
});
