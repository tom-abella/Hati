import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accountDb } from '../lib/db.js';

test('accounts use separate databases from each other and the old preview', () => {
  assert.equal(accountDb('one').name, 'hati-account-one');
  assert.notEqual(accountDb('one').name, accountDb('two').name);
  assert.notEqual(accountDb('one').name, 'hati-local-preview');
});
