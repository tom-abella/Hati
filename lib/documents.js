import { z } from 'zod';
import { amountSchema, toCentavos } from './money.js';

const date = z.iso.date();
const documentSchema = z.object({
  type: z.enum(['expense', 'bill', 'statement']),
  merchant: z.string().trim().min(1, 'Enter the merchant or provider.').max(80),
  date,
  dueDate: z.union([date, z.literal('')]),
  amount: amountSchema,
  currency: z.literal('PHP', 'Only PHP is supported by the current reports.'),
});

export function validateDocument(input) {
  const item = documentSchema.parse(input);
  if (item.type !== 'expense' && !item.dueDate) throw new Error('Enter the payment due date.');
  return { ...item, amount: toCentavos(item.amount) };
}

export function possibleDuplicate(item, records) {
  return records.some(record => record.date === item.date && record.amount === item.amount && (record.type === item.type || item.type === 'expense' && record.type === 'expense'));
}
