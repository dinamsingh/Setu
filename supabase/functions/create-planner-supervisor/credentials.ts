/**
 * Server-side password generation for planner-created supervisors.
 * Same unambiguous 32-symbol alphabet as the evaluator credentials:
 * 16 unbiased characters = 80 bits of entropy, grouped 4-4-4-4.
 * The password is returned to the planner ONCE and is never stored in
 * the database, never logged, and never copied into frontend code.
 */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function makePlannerSupervisorPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const key = Array.from(bytes, (n) => ALPHABET[n & 31]).join("");
  const chunks = key.match(/.{4}/g);
  if (!chunks || chunks.length !== 4) throw new Error("Could not generate credentials");
  return "SETU-" + chunks.join("-");
}

export function isValidWorkEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 254;
}

export function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
