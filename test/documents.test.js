import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDocument, possibleDuplicate } from '../lib/documents.js';

test('documents validate dates and PHP centavos and require bill due dates', () => {
  const input = { type: 'expense', merchant: 'Shop', date: '2026-11-10', dueDate: '', amount: '10.05', currency: 'PHP' };
  assert.equal(validateDocument(input).amount, 1005);
  assert.throws(() => validateDocument({ ...input, type: 'bill' }));
  assert.throws(() => validateDocument({ ...input, currency: 'USD' }));
  assert.equal(possibleDuplicate(validateDocument(input), [{ type: 'expense', date: input.date, amount: 1005 }]), true);
});
