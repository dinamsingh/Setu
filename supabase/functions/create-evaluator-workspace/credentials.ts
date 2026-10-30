/**
 * Human-readable, cryptographically random disposable evaluator credentials.
 * Distinct workspaces retain distinct IDs; both roles share a readable suffix.
 * 16 unbiased characters from a 32-symbol alphabet = 80 bits of entropy.
 */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export type DemoRole = "site" | "planner";

export function makeEvaluatorCredentials(workspaceId: string, role: DemoRole): {email: string; password: string} {
  // UUID v4 random prefix: 12 hexadecimal digits = 48 random bits.
  // It is merely a readable alias, NOT an access-control key. Server RLS uses
  // full workspace UUID and authenticated user IDs.
  const code = workspaceId.replaceAll("-", "").slice(0, 12).toLowerCase();
  if (!/^[a-f0-9]{12}$/.test(code)) throw new Error("Invalid evaluator workspace ID");
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const key = Array.from(bytes, n => ALPHABET[n & 31]).join("");
  const chunks = key.match(/.{4}/g);
  if (!chunks || chunks.length !== 4) throw new Error("Could not generate credentials");
  return {
    email: (role === "site" ? "supervisor" : "planner") + "-" + code + "@setu.invalid",
    password: "SETU-" + chunks.join("-"),
  };
}
