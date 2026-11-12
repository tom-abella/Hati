import { test } from 'node:test';
import assert from 'node:assert/strict';
import { availableCredit } from '../lib/cards.js';
import { statementPurchases, supplementarySpent } from '../lib/supplementary.js';

test('card spending, payments, undo and deleted expenses affect available credit', () => {
  const card = { id: 'card', limit: 100000 };
  const expenses = [{ card_id: 'card', type: 'expense', amount: 25000 }, { card_id: 'other', type: 'expense', amount: 5000 }];
  const payment = { cardId: 'card', amount: 10000, paid: false };
  assert.equal(availableCredit(card, expenses, [payment]), 75000);
  payment.paid = true;
  assert.equal(availableCredit(card, expenses, [payment]), 85000);
  payment.deleted = true;
  assert.equal(availableCredit(card, expenses, [payment]), 75000);
  payment.deleted = false;
  payment.paid = false;
  assert.equal(availableCredit(card, expenses, [payment]), 75000);
  assert.equal(availableCredit(card, [], [payment]), 100000);
});

test('statement credit restores only allocated purchases, preserving later spending and undo', () => {
  const card = { id: 'card', limit: 2000000 };
  const expenses = [{ id: 'old', card_id: 'card', type: 'expense', amount: 600000 }, { id: 'new', card_id: 'card', type: 'expense', amount: 100000 }];
  const sharedCards = [{ id: 'supp', primary_card_id: 'card' }];
  const shared = [{ id: 's1', supplementary_card_id: 'supp', amount: 400000, date: '2026-11-01' }, { id: 's2', supplementary_card_id: 'supp', amount: 100000, date: '2026-11-12' }];
  const reminder = { id: 'bill', cardId: 'card', paid: true, amount: 1100000, statementDate: '2026-11-10' };
  const allocations = [{ reminder_id: 'bill', transaction_id: 'old', amount: 600000 }, { reminder_id: 'bill', transaction_id: 's1', amount: 400000 }];
  assert.equal(availableCredit(card, expenses, [reminder], allocations) - supplementarySpent('card', sharedCards, shared), 1800000);
  reminder.statementAllocations = [{ transactionId: 'old', amount: 600000 }, { transactionId: 's1', amount: 400000 }];
  assert.equal(availableCredit(card, expenses, [reminder]) - supplementarySpent('card', sharedCards, shared), 1800000);
  assert.deepEqual(statementPurchases('card', '2026-11-10', sharedCards, shared, [{ transaction_id: 's1' }]), []);
  reminder.paid = false;
  assert.equal(availableCredit(card, expenses, [reminder], allocations) - supplementarySpent('card', sharedCards, shared), 800000);
});
