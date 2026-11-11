export function availableCredit(card, transactions, reminders) {
  const spent = transactions.filter(entry => entry.card_id === card.id && entry.type === 'expense').reduce((sum, entry) => sum + entry.amount, 0);
  const paid = reminders.filter(reminder => reminder.cardId === card.id && reminder.paid).reduce((sum, reminder) => sum + reminder.amount, 0);
  return card.limit - spent + paid;
}
