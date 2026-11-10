export function paymentStatus(reminder, today) {
  if (reminder.paid) return 'Paid';
  if (reminder.dueDate < today) return 'Overdue';
  if (reminder.dueDate === today) return 'Due today';
  return 'Upcoming';
}
