import { test } from 'node:test';
import assert from 'node:assert/strict';
import { availableCredit } from '../lib/cards.js';

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
