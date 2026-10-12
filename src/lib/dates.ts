// Today as the calendar day of the place the server runs in, in the form a date column takes.
export function localToday(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${now.getFullYear()}-${month}-${day}`;
}

// A date column comes back as midnight UTC of its day.
export function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}
