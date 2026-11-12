async function allRows(client, table, key, signal) {
  const rows = [];
  let cursor;
  do {
    let query = client.from(table).select('*').order(key).limit(500);
    if (cursor) query = query.gt(key, cursor);
    const { data, error } = await query.abortSignal(signal);
    if (error) throw error;
    rows.push(...data);
    cursor = data.length === 500 ? data[data.length - 1][key] : null;
  } while (cursor && !signal.aborted);
  return rows;
}

export async function loadSupplementary(client, signal) {
  const [cards, transactions, allocations, primaryAllocations] = await Promise.all([
    allRows(client, 'supplementary_cards', 'id', signal),
    allRows(client, 'supplementary_transactions', 'id', signal),
    allRows(client, 'supplementary_statement_allocations', 'transaction_id', signal),
    allRows(client, 'primary_statement_allocations', 'transaction_id', signal),
  ]);
  const balances = {};
  for (const card of cards.filter(item => item.accepted_at && !item.revoked_at)) {
    const { data, error } = await client.rpc('supplementary_balance', { p_id: card.id }).abortSignal(signal).maybeSingle();
    if (error) throw error;
    balances[card.id] = data;
  }
  return { cards, transactions, allocations, primaryAllocations, balances };
}

export function supplementarySpent(primaryId, cards, transactions) {
  const ids = new Set(cards.filter(card => card.primary_card_id === primaryId).map(card => card.id));
  return transactions.filter(entry => ids.has(entry.supplementary_card_id) && !entry.deleted_at).reduce((sum, entry) => sum + Number(entry.amount), 0);
}

export function statementPurchases(primaryId, closingDate, cards, transactions, allocations) {
  const ids = new Set(cards.filter(card => card.primary_card_id === primaryId).map(card => card.id));
  const paid = new Set(allocations.map(item => item.transaction_id));
  return transactions.filter(entry => ids.has(entry.supplementary_card_id) && !entry.deleted_at && entry.date <= closingDate && !paid.has(entry.id));
}
