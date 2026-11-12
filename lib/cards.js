export function availableCredit(card, transactions, reminders, allocations = []) {
  const spent = transactions.filter(entry => entry.card_id === card.id && entry.type === 'expense').reduce((sum, entry) => sum + entry.amount, 0);
  const paid = reminders.filter(reminder => reminder.cardId === card.id && reminder.paid && !reminder.deleted).reduce((sum, reminder) => {
    if (!reminder.statementDate) return sum + reminder.amount;
    const covered = reminder.statementAllocations || allocations.filter(item => item.reminder_id === reminder.id);
    return sum + covered.reduce((total, item) => total + Number(item.amount), 0);
  }, 0);
  return card.limit - spent + paid;
}
