export function receiptSuggestions(text) {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const total = lines.find(line => /\b(?:grand\s+total|amount\s+due|total\s+due|total)\b/i.test(line) && !/\b(?:subtotal|sub total)\b/i.test(line));
  const amount = total?.match(/(?:₱|PHP|P\s*)?\s*(\d[\d,]*\.\d{2})\b/i)?.[1]?.replaceAll(',', '') || '';
  const dateMatch = text.match(/\b(20\d{2})[-/](0?[1-9]|1[0-2])[-/](0?[1-9]|[12]\d|3[01])\b/);
  const date = dateMatch ? `${dateMatch[1]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[3].padStart(2, '0')}` : '';
  return { merchant: lines[0]?.slice(0, 80) || '', amount, date };
}
