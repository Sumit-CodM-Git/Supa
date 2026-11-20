/** DDMMYY for the current calendar date in India, independent of the server timezone. */
export function visitorDateOtp(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", day: "2-digit", month: "2-digit", year: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find(part => part.type === type)!.value;
  return `${get("day")}${get("month")}${get("year")}`;
}
