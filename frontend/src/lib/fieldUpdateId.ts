/** Independent of row visibility/counts; the database unique constraint remains authoritative. */
export function createFieldUpdateId(): string {
  return `UPD-${new Date().getUTCFullYear()}-${crypto.randomUUID().toUpperCase()}`;
}
