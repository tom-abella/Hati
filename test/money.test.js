import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCentavos } from '../lib/money.js';

test('amounts convert to integer centavos without rounding', () => {
  assert.equal(toCentavos('100.5'), 10050);
  assert.equal(toCentavos('0.01'), 1);
  assert.throws(() => toCentavos('1.001'));
  assert.throws(() => toCentavos('0'));
});
