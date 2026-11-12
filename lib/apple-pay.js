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

function dateLabel(text) {
  return text.match(/\b20\d{2}[-/]\d{1,2}[-/]\d{1,2}\b|\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+20\d{2}\b|\b\d{1,2}\/\d{1,2}\/(?:\d{4}|\d{2})\b|\b\d{1,4}\s*(?:hours?|hrs?)\s+ago\b|\b(?:today|yesterday|sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|wed|thu|fri|sat)\b/i)?.[0] || '';
}

function dateLine(text) {
  const label = dateLabel(text);
  if (!label) return '';
  const rest = text.replace(label, '').trim();
  return /^(?:[,· -]*(?:at\s+)?\d{1,2}:\d{2}\s*(?:am|pm)?)?$/i.test(rest) ? label : '';
}

export function resolveHistoryDate(label, capturedAt, dateOrder) {
  const absolute = fullDate(label);
  if (absolute) return absolute;
  const numeric = label.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})$/);
  if (numeric) {
    const first = Number(numeric[1]);
    const second = Number(numeric[2]);
    const order = dateOrder || (first > 12 ? 'DMY' : second > 12 ? 'MDY' : '');
    if (!['MDY', 'DMY'].includes(order)) return '';
    const year = numeric[3].length === 2 ? 2000 + Number(numeric[3]) : Number(numeric[3]);
    const month = order === 'MDY' ? first : second;
    const day = order === 'MDY' ? second : first;
    return fullDate(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  }
  const captured = String(capturedAt || '').match(/^(20\d{2}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)$/);
  if (!captured || !fullDate(captured[1])) return '';
  const reference = new Date(`${captured[1]}T${captured[2]}:${captured[3]}:00Z`);
  if (/^yesterday$/i.test(label)) reference.setUTCDate(reference.getUTCDate() - 1);
  else if (!/^today$/i.test(label)) {
    const hours = label.match(/^(\d{1,4})\s*(?:hours?|hrs?)\s+ago$/i);
    if (hours) reference.setUTCHours(reference.getUTCHours() - Number(hours[1]));
    else {
      const weekday = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(label.slice(0, 3).toLowerCase());
      if (weekday < 0) return '';
      const days = (reference.getUTCDay() - weekday + 7) % 7;
      if (!days) return '';
      reference.setUTCDate(reference.getUTCDate() - days);
    }
  }
  return reference.toISOString().slice(0, 10);
}

export function applePaySuggestions(text, { capturedAt = '', dateOrder = '' } = {}) {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const amountPattern = /([+-]?)\s*(₱|\$|€|£|¥|\bPHP\b|\bUSD\b|\bEUR\b|\bGBP\b|\bJPY\b|\bSGD\b|\bHKD\b|\bAUD\b|\bCAD\b|\bP\b)?\s*([+-]?)\s*(\d[\d,]*\.\d{2})(?:\s*\b(PHP|USD|EUR|GBP|JPY|SGD|HKD|AUD|CAD)\b)?/i;
  const metadata = /^(?:today|yesterday|pending|completed|declined|refunded|transactions|latest transactions|\d{1,2}:\d{2}(?:\s*[ap]m)?|\d{4}[-/]\d{1,2}[-/]\d{1,2})$/i;
  return lines.flatMap((line, index) => {
    const match = line.match(amountPattern);
    if (!match) return [];
    const before = line.slice(0, match.index).trim();
    const previous = lines[index - 1] || '';
    const merchant = before || (!metadata.test(previous) && !dateLine(previous) && !amountPattern.test(previous) ? previous : '');
    const currencies = [match[2], match[5]].filter(Boolean).map(value => value.toUpperCase());
    const foreignCurrency = currencies.some(value => !['₱', 'PHP', 'P'].includes(value));
    const following = lines[index + 1] || '';
    const followingLabel = amountPattern.test(following) ? '' : dateLine(following);
    const precedingLabel = index > 0 && !amountPattern.test(lines[index - 2] || '') ? dateLine(previous) : '';
    const lineLabel = dateLabel(line);
    const absoluteLineLabel = fullDate(lineLabel) || /^\d{1,2}\/\d{1,2}\/(?:\d{4}|\d{2})$/.test(lineLabel) ? lineLabel : '';
    const detectedDate = dateLabel(line.slice(match.index + match[0].length)) || absoluteLineLabel || followingLabel || precedingLabel;
    const detail = /^(pending|declined|refunded|reversed|cancelled)$/i.test(following) || followingLabel ? ` · ${following}` : '';
    return [{ merchant: merchant.slice(0, 80), amount: match[4].replaceAll(',', ''), date: resolveHistoryDate(detectedDate, capturedAt, dateOrder), dateLabel: detectedDate, currency: currencies.length && !foreignCurrency ? 'PHP' : '', foreignCurrency, source: `${line}${detail}` }];
  });
}

export function applyPhilippinesCurrency(rows, enabled) {
  return rows.map(row => {
    if (row.currencyEdited || row.foreignCurrency || (row.currency && !row.currencyAssumed)) return row;
    return { ...row, currency: enabled ? 'PHP' : '', currencyAssumed: enabled };
  });
}

export function duplicateCount(records, existing) {
  return records.filter((record, index) => possibleDuplicate(record, existing) || possibleDuplicate(record, records.slice(0, index))).length;
}
