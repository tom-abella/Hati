import { z } from 'zod';

export const amountSchema = z.string().trim().regex(/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/, 'Enter a valid amount with up to two decimal places.').refine(value => Number(value) > 0, 'Amount must be greater than zero.');

export function toCentavos(value) {
  const valid = amountSchema.parse(value);
  const [pesos, decimals = ''] = valid.split('.');
  return Number(pesos) * 100 + Number(decimals.padEnd(2, '0'));
}

export function money(value) {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(value / 100);
}
