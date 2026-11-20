/** Assignment writers store IST wall time in a timestamp-without-time-zone column.
 * Explicit offsets represent an instant and must never be shifted a second time.
 */
export function parseComplaintAssignmentTime(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  let date: Date;
  if (value instanceof Date) date = value;
  else {
    const text = value.trim().replace(" ", "T");
    const hasOffset = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(text);
    date = new Date(hasOffset ? text : `${text}+05:30`);
  }
  return Number.isNaN(date.getTime()) ? null : date;
}

export function complaintAssignmentISO(value: string | Date | null | undefined): string | null {
  return parseComplaintAssignmentTime(value)?.toISOString() ?? null;
}

/** Return the assignment instant as local IST ISO-8601 with an explicit offset. */
export function complaintAssignmentISTISO(value: string | Date | null | undefined): string | null {
  const date = parseComplaintAssignmentTime(value);
  if (!date) return null;
  return new Date(date.getTime() + 330 * 60_000).toISOString().replace("Z", "+05:30");
}
