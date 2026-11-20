/** Visitor check-in/out writers use UTC ISO timestamps in timestamp-without-time-zone
 * columns. Treat their offset-less database values as UTC, not server/device local time.
 */
export function visitorTimeISTISO(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date && Number.isNaN(value.getTime())) return null;
  const text = value instanceof Date ? value.toISOString() : value.trim().replace(" ", "T");
  const hasOffset = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(text);
  const instant = new Date(hasOffset ? text : `${text}Z`);
  if (Number.isNaN(instant.getTime())) return null;
  return new Date(instant.getTime() + 330 * 60_000).toISOString().replace("Z", "+05:30");
}
