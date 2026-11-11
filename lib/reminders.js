export function paymentStatus(reminder, today) {
  if (reminder.paid) return 'Paid';
  if (reminder.dueDate < today) return 'Overdue';
  if (reminder.dueDate === today) return 'Due today';
  return 'Upcoming';
}

export function reminderSendAt(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Enter a valid date and notification time.');
  const value = new Date(`${date}T${time}:00+08:00`);
  if (Number.isNaN(value.getTime()) || new Date(value.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 16) !== `${date}T${time}`) throw new Error('Enter a valid date and notification time.');
  return value.toISOString();
}
