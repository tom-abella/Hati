import { possibleDuplicate } from './documents.js';

function fullDate(text) {
  const iso = text.match(/\b(20\d{2})[-/](0?[1-9]|1[0-2])[-/](0?[1-9]|[12]\d|3[01])\b/);
  const named = text.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),?\s+(20\d{2})\b/i);
  if (!iso && !named) return '';
  const year = iso ? iso[1] : named[3];
  const month = iso ? Number(iso[2]) : ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(named[1].slice(0, 3).toLowerCase()) + 1;
  const day = Number(iso ? iso[3] : named[2]);
  const result = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const date = new Date(`${result}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === result ? result : '';
}

export function applePaySuggestions(text) {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const amountPattern = /([+-]?)\s*(₱|\$|€|£|¥|\bPHP\b|\bUSD\b|\bEUR\b|\bGBP\b|\bP\b)?\s*([+-]?)\s*(\d[\d,]*\.\d{2})(?:\s*\b(PHP|USD|EUR|GBP)\b)?/i;
  const metadata = /^(?:today|yesterday|pending|completed|declined|refunded|transactions|latest transactions|\d{1,2}:\d{2}(?:\s*[ap]m)?|\d{4}[-/]\d{1,2}[-/]\d{1,2})$/i;
  return lines.flatMap((line, index) => {
    const match = line.match(amountPattern);
    if (!match) return [];
    const before = line.slice(0, match.index).trim();
    const previous = lines[index - 1] || '';
    const merchant = before || (!metadata.test(previous) && !fullDate(previous) && !amountPattern.test(previous) ? previous : '');
    const currency = (match[2] || match[5] || '').toUpperCase();
    const following = lines[index + 1] || '';
    const date = fullDate(line) || fullDate(following);
    const detail = /^(pending|declined|refunded|reversed|cancelled)$/i.test(following) || fullDate(following) ? ` · ${following}` : '';
    return [{ merchant: merchant.slice(0, 80), amount: match[4].replaceAll(',', ''), date, currency: ['₱', 'PHP', 'P'].includes(currency) ? 'PHP' : '', source: `${line}${detail}` }];
  });
}

export function duplicateCount(records, existing) {
  return records.filter((record, index) => possibleDuplicate(record, existing) || possibleDuplicate(record, records.slice(0, index))).length;
}
