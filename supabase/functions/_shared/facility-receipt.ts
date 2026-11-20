import { receiptStorageKey, resolveReceiptImage } from "./receipt-storage.ts";

/** Preserve original references, then try the historical financial folder casing. */
export async function resolveFacilityReceiptImage(client: any, values: unknown[]) {
  const alternatives = values.flatMap((value) => {
    if (typeof value !== "string" || !value.trim()) return [];
    const key = receiptStorageKey(value);
    if (!key) return [];
    const parts = key.split("/");
    if (parts[1] !== "Financial" && parts[1] !== "financial") return [];
    parts[1] = parts[1] === "Financial" ? "financial" : "Financial";
    return [parts.join("/")];
  });
  return await resolveReceiptImage(client, [...values, ...alternatives]);
}
