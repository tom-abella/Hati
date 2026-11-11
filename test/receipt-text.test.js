import { test } from 'node:test';
import assert from 'node:assert/strict';
import { receiptSuggestions } from '../lib/receipt-text.js';

test('extracts conservative receipt suggestions and ignores subtotals', () => {
  assert.deepEqual(receiptSuggestions('Shop\n2026-11-09\nSUBTOTAL 900.00\nTOTAL PHP 1,234.50'), { merchant: 'Shop', date: '2026-11-09', amount: '1234.50' });
  assert.deepEqual(receiptSuggestions('Shop\nSUBTOTAL 900.00'), { merchant: 'Shop', date: '', amount: '' });
});
